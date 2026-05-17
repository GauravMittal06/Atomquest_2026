"""
Check-ins router.
Enforces rules from docs/CHECKIN_RULES.md.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from auth import get_current_user, require_roles
from database import COLLECTION_CHECKINS, COLLECTION_GOALS, COLLECTION_GOAL_SHEETS, get_database
from models.check_in import (
    CheckInCreate,
    CheckInPublic,
    CheckInUpdate,
    ManagerRemarkUpdate,
)
from models.goal import UoMType
from models.goal_sheet import GoalSheetStatus
from models.user import TokenData, UserRole

router = APIRouter(prefix="/api/checkins", tags=["Check-ins"])

GRACE_WINDOW_HOURS = 24


def _serialize(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


async def _resolve_goal_and_sheet(goal_id: str, db):
    goal = await db[COLLECTION_GOALS].find_one({"_id": ObjectId(goal_id)})
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    sheet = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(goal["goal_sheet_id"])})
    if not sheet:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")
    return goal, sheet


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("/", response_model=CheckInPublic, status_code=status.HTTP_201_CREATED)
async def add_check_in(
    body: CheckInCreate,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    goal, sheet = await _resolve_goal_and_sheet(body.goal_id, db)

    # State gate: APPROVED or LOCKED (CHECKIN_RULES.md §2)
    sheet_status = GoalSheetStatus(sheet["status"])
    if sheet_status not in (GoalSheetStatus.APPROVED, GoalSheetStatus.LOCKED):
        raise HTTPException(
            status_code=422,
            detail="Check-ins can only be added to APPROVED or LOCKED Goal Sheets.",
        )
    if sheet_status == GoalSheetStatus.LOCKED:
        raise HTTPException(status_code=422, detail="Goal Sheet is LOCKED; no new check-ins allowed.")

    # Ownership check
    if sheet["employee_id"] != current.user_id and current.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Access denied.")

    # Duplicate check-in guard (CHECKIN_RULES.md §4)
    existing = await db[COLLECTION_CHECKINS].find_one({
        "goal_id": body.goal_id,
        "period_label": body.period_label,
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A check-in for period '{body.period_label}' already exists for this goal.",
        )

    doc = body.model_dump()
    doc["goal_sheet_id"] = goal["goal_sheet_id"]
    doc["created_by"] = current.user_id
    doc["check_in_date"] = datetime.now(timezone.utc)
    doc["is_editable"] = True

    result = await db[COLLECTION_CHECKINS].insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    # Update goal's latest actual value & achievement
    await _update_goal_achievement(body.goal_id, body.actual_value, goal, db)

    return doc


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

@router.get("/goal/{goal_id}", response_model=List[CheckInPublic])
async def list_check_ins_for_goal(
    goal_id: str,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    goal, sheet = await _resolve_goal_and_sheet(goal_id, db)

    if current.role == UserRole.EMPLOYEE and sheet["employee_id"] != current.user_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    cursor = db[COLLECTION_CHECKINS].find({"goal_id": goal_id})
    return [_serialize(d) async for d in cursor]


# ---------------------------------------------------------------------------
# Update (within grace window)
# ---------------------------------------------------------------------------

@router.patch("/{checkin_id}", response_model=CheckInPublic)
async def update_check_in(
    checkin_id: str,
    body: CheckInUpdate,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    doc = await db[COLLECTION_CHECKINS].find_one({"_id": ObjectId(checkin_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Check-in not found")

    if doc["created_by"] != current.user_id and current.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Access denied.")

    grace_cutoff = doc["check_in_date"] + timedelta(hours=GRACE_WINDOW_HOURS)
    if datetime.now(timezone.utc) > grace_cutoff and current.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=422,
            detail=f"Check-in can only be edited within {GRACE_WINDOW_HOURS} hours of creation.",
        )

    update_data = body.model_dump(exclude_none=True)
    await db[COLLECTION_CHECKINS].update_one({"_id": ObjectId(checkin_id)}, {"$set": update_data})

    if "actual_value" in update_data:
        goal = await db[COLLECTION_GOALS].find_one({"_id": ObjectId(doc["goal_id"])})
        if goal:
            await _update_goal_achievement(doc["goal_id"], update_data["actual_value"], goal, db)

    updated = await db[COLLECTION_CHECKINS].find_one({"_id": ObjectId(checkin_id)})
    return _serialize(updated)


# ---------------------------------------------------------------------------
# Manager remark
# ---------------------------------------------------------------------------

@router.patch("/{checkin_id}/manager-remark", response_model=CheckInPublic)
async def add_manager_remark(
    checkin_id: str,
    body: ManagerRemarkUpdate,
    current: TokenData = Depends(require_roles(UserRole.MANAGER, UserRole.ADMIN)),
):
    db = get_database()
    doc = await db[COLLECTION_CHECKINS].find_one({"_id": ObjectId(checkin_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Check-in not found")

    await db[COLLECTION_CHECKINS].update_one(
        {"_id": ObjectId(checkin_id)},
        {"$set": {"manager_remark": body.manager_remark, "manager_id": current.user_id}},
    )
    updated = await db[COLLECTION_CHECKINS].find_one({"_id": ObjectId(checkin_id)})
    return _serialize(updated)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _update_goal_achievement(goal_id: str, actual_value, goal: dict, db) -> None:
    """Recalculate achievement_pct and goal_score from latest check-in."""
    uom_type = goal.get("uom_type")
    weightage = float(goal.get("weightage", 0))
    target_value = goal.get("target_value")

    achievement_pct: float | None = None
    goal_score: float | None = None

    if uom_type == UoMType.QUANTITATIVE:
        try:
            actual = float(actual_value)
            target = float(target_value)
            if target > 0:
                achievement_pct = round((actual / target) * 100, 2)
                goal_score = round(min(achievement_pct, 100) * (weightage / 100), 4)
        except (TypeError, ValueError):
            pass

    await db[COLLECTION_GOALS].update_one(
        {"_id": ObjectId(goal_id)},
        {"$set": {
            "latest_actual_value": actual_value,
            "achievement_pct": achievement_pct,
            "goal_score": goal_score,
            "updated_at": datetime.utcnow(),
        }},
    )
