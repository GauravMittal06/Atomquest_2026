"""
Check-ins router.

Enforces:
  - Quarterly window restrictions per docs/CHECKIN_RULES.md
  - Progress-score formulas per docs/VALIDATION_RULES.md (delegated to
    services/progress_calculator.py — single source of truth for the maths)
  - Shared-goal achievement sync per docs/SHARED_GOALS.md
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
from models.goal_sheet import GoalSheetStatus
from models.user import TokenData, UserRole
from services.checkin_window import get_current_cycle_status, is_input_window_open
from services.live_scoring import enrich_goal_with_live_score, enrich_sheet_with_live_score
from services.progress_calculator import calculate_progress

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


def _require_open_window(role: UserRole) -> None:
    """
    Block achievement-input mutations outside the active quarterly window
    (docs/CHECKIN_RULES.md §Restrictions). Admins are allowed through so they
    can demo or back-fill data.
    """
    if role == UserRole.ADMIN:
        return
    if not is_input_window_open():
        status_now = get_current_cycle_status()
        raise HTTPException(
            status_code=422,
            detail=(
                f"Check-in inputs are read-only — {status_now.banner_title}. "
                "The next window opens "
                f"{status_now.next_window_opens.isoformat() if status_now.next_window_opens else 'shortly'}."
            ),
        )


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

    sheet_status = GoalSheetStatus(sheet["status"])
    if sheet_status not in (GoalSheetStatus.APPROVED, GoalSheetStatus.LOCKED):
        raise HTTPException(
            status_code=422,
            detail="Check-ins can only be added to APPROVED or LOCKED Goal Sheets.",
        )

    if sheet["employee_id"] != current.user_id and current.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Access denied.")

    _require_open_window(current.role)

    existing = await db[COLLECTION_CHECKINS].find_one({
        "goal_id": body.goal_id,
        "period_label": body.period_label,
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A check-in for period '{body.period_label.value}' already exists for this goal.",
        )

    doc = body.model_dump()
    doc["goal_sheet_id"] = goal["goal_sheet_id"]
    doc["created_by"] = current.user_id
    doc["check_in_date"] = datetime.now(timezone.utc)
    doc["is_editable"] = True

    result = await db[COLLECTION_CHECKINS].insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    await _update_goal_achievement(body.goal_id, body.actual_value, goal, db)
    await _recompute_sheet_overall_score(goal["goal_sheet_id"], db)

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
    _goal, sheet = await _resolve_goal_and_sheet(goal_id, db)

    if current.role == UserRole.EMPLOYEE and sheet["employee_id"] != current.user_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    cursor = db[COLLECTION_CHECKINS].find({"goal_id": goal_id})
    return [_serialize(d) async for d in cursor]


@router.get("/sheet/{sheet_id}", response_model=List[CheckInPublic])
async def list_check_ins_for_sheet(
    sheet_id: str,
    current: TokenData = Depends(get_current_user),
):
    """All check-ins across every goal on a sheet (used by Manager review view)."""
    db = get_database()
    sheet = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not sheet:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")
    if current.role == UserRole.EMPLOYEE and sheet["employee_id"] != current.user_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    cursor = db[COLLECTION_CHECKINS].find({"goal_sheet_id": sheet_id})
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

    _require_open_window(current.role)

    # Motor returns MongoDB datetimes as offset-naive UTC; attach tzinfo so the
    # comparison with datetime.now(timezone.utc) (offset-aware) doesn't raise.
    grace_cutoff = (doc["check_in_date"] + timedelta(hours=GRACE_WINDOW_HOURS)).replace(
        tzinfo=timezone.utc
    )
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
            await _recompute_sheet_overall_score(doc["goal_sheet_id"], db)

    updated = await db[COLLECTION_CHECKINS].find_one({"_id": ObjectId(checkin_id)})
    return _serialize(updated)


# ---------------------------------------------------------------------------
# Manager remark (legacy free-text remark on a single check-in)
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
    """
    Update goal's latest_actual_value for tracking purposes.
    Note: achievement_pct and goal_score are now computed live, not persisted.
    """
    # Only update the latest_actual_value, scores are computed live
    await db[COLLECTION_GOALS].update_one(
        {"_id": ObjectId(goal_id)},
        {"$set": {
            "latest_actual_value": actual_value,
            "updated_at": datetime.utcnow(),
        }},
    )

    # Shared-goal achievement sync (docs/SHARED_GOALS.md)
    shared_ref = goal.get("shared_goal_ref")
    if isinstance(shared_ref, dict) and shared_ref.get("is_shared"):
        link_id = shared_ref.get("link_id")
        primary_owner_id = shared_ref.get("primary_owner_id")
        if link_id and primary_owner_id and goal.get("owner_id") == primary_owner_id:
            # For shared goals, we still need to sync achievement across linked goals
            # But we compute it live rather than persisting it
            progress = calculate_progress(
                uom_type=goal.get("uom_type"),
                target_value=goal.get("target_value"),
                actual_value=actual_value,
                weightage=float(goal.get("weightage", 0)),
            )
            await _sync_shared_goal_achievement(
                link_id=link_id,
                primary_goal_id=goal_id,
                actual_value=actual_value,
                achievement_pct=progress.achievement_pct,
                db=db,
            )


async def _sync_shared_goal_achievement(
    link_id: str,
    primary_goal_id: str,
    actual_value,
    achievement_pct,
    db,
) -> None:
    """Propagate the primary owner's achievement to all linked goal copies."""
    async for linked_goal in db[COLLECTION_GOALS].find(
        {
            "shared_goal_ref.link_id": link_id,
            "_id": {"$ne": ObjectId(primary_goal_id)},
        }
    ):
        # Re-evaluate the linked copy's score from its own weightage so each
        # employee keeps the score they negotiated even when they share a KPI.
        from services.progress_calculator import calculate_goal_score
        linked_score = calculate_goal_score(achievement_pct, float(linked_goal.get("weightage", 0)))
        # Only update latest_actual_value for shared goals
        # achievement_pct and goal_score are computed live
        await db[COLLECTION_GOALS].update_one(
            {"_id": linked_goal["_id"]},
            {"$set": {
                "latest_actual_value": actual_value,
                "updated_at": datetime.utcnow(),
            }},
        )
        await _recompute_sheet_overall_score(str(linked_goal["goal_sheet_id"]), db)


async def _recompute_sheet_overall_score(sheet_id: str, db) -> None:
    """
    Update sheet timestamp. 
    Note: overall_score is now computed live, not persisted.
    """
    # Only update the timestamp, overall_score is computed live
    await db[COLLECTION_GOAL_SHEETS].update_one(
        {"_id": ObjectId(sheet_id)},
        {"$set": {"updated_at": datetime.utcnow()}},
    )
