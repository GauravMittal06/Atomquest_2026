"""
Goals router.
Validates Thrust Area, UoM, Target, and Weightage per docs/VALIDATION_RULES.md.
"""

from __future__ import annotations

from datetime import datetime
from typing import List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from auth import get_current_user
from database import COLLECTION_GOAL_SHEETS, COLLECTION_GOALS, get_database
from models.goal import GoalCreate, GoalPublic, GoalUpdate
from models.goal_sheet import GoalSheetStatus
from models.user import TokenData, UserRole

router = APIRouter(prefix="/api/goals", tags=["Goals"])

# Max goals per sheet (VALIDATION_RULES.md §5)
MAX_GOALS = 10
MIN_GOALS = 3


def _serialize(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


async def _get_editable_sheet(sheet_id: str, user_id: str, role: UserRole, db):
    """Fetch a sheet and verify it is editable by this user."""
    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")

    editable_statuses = {GoalSheetStatus.DRAFT, GoalSheetStatus.RETURNED}
    if GoalSheetStatus(doc["status"]) not in editable_statuses:
        raise HTTPException(
            status_code=422,
            detail="Goals can only be added/edited when the sheet is DRAFT or RETURNED.",
        )
    if doc["employee_id"] != user_id and role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Access denied.")
    return doc


async def _recalculate_sheet_totals(sheet_id: str, db) -> None:
    """Recompute goal_count and total_weightage on the parent sheet."""
    pipeline = [
        {"$match": {"goal_sheet_id": sheet_id}},
        {"$group": {"_id": None, "count": {"$sum": 1}, "total_wt": {"$sum": "$weightage"}}},
    ]
    async for result in db[COLLECTION_GOALS].aggregate(pipeline):
        await db[COLLECTION_GOAL_SHEETS].update_one(
            {"_id": ObjectId(sheet_id)},
            {"$set": {
                "goal_count": result["count"],
                "total_weightage": round(result["total_wt"], 4),
                "updated_at": datetime.utcnow(),
            }},
        )
        return
    # No goals remain
    await db[COLLECTION_GOAL_SHEETS].update_one(
        {"_id": ObjectId(sheet_id)},
        {"$set": {"goal_count": 0, "total_weightage": 0.0, "updated_at": datetime.utcnow()}},
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.get("/sheet/{sheet_id}", response_model=List[GoalPublic])
async def list_goals(
    sheet_id: str,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    sheet = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not sheet:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")

    if current.role == UserRole.EMPLOYEE and sheet["employee_id"] != current.user_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    cursor = db[COLLECTION_GOALS].find({"goal_sheet_id": sheet_id})
    return [_serialize(d) async for d in cursor]


@router.post("/sheet/{sheet_id}", response_model=GoalPublic, status_code=status.HTTP_201_CREATED)
async def add_goal(
    sheet_id: str,
    body: GoalCreate,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    sheet = await _get_editable_sheet(sheet_id, current.user_id, current.role, db)

    if sheet.get("goal_count", 0) >= MAX_GOALS:
        raise HTTPException(status_code=422, detail=f"Maximum {MAX_GOALS} goals per sheet.")

    # Duplicate detection: same thrust_area + description (VALIDATION_RULES.md §5)
    dup = await db[COLLECTION_GOALS].find_one({
        "goal_sheet_id": sheet_id,
        "thrust_area": body.thrust_area,
        "description": body.description,
    })
    if dup:
        raise HTTPException(status_code=409, detail="A goal with the same Thrust Area and Description already exists.")

    doc = body.model_dump()
    doc["goal_sheet_id"] = sheet_id
    doc["owner_id"] = sheet["employee_id"]
    doc["created_at"] = datetime.utcnow()

    result = await db[COLLECTION_GOALS].insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    await _recalculate_sheet_totals(sheet_id, db)
    return doc


@router.patch("/{goal_id}", response_model=GoalPublic)
async def update_goal(
    goal_id: str,
    body: GoalUpdate,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    goal = await db[COLLECTION_GOALS].find_one({"_id": ObjectId(goal_id)})
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    await _get_editable_sheet(goal["goal_sheet_id"], current.user_id, current.role, db)

    update_data = body.model_dump(exclude_none=True)
    update_data["updated_at"] = datetime.utcnow()
    await db[COLLECTION_GOALS].update_one({"_id": ObjectId(goal_id)}, {"$set": update_data})
    await _recalculate_sheet_totals(goal["goal_sheet_id"], db)

    doc = await db[COLLECTION_GOALS].find_one({"_id": ObjectId(goal_id)})
    return _serialize(doc)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(
    goal_id: str,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    goal = await db[COLLECTION_GOALS].find_one({"_id": ObjectId(goal_id)})
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    await _get_editable_sheet(goal["goal_sheet_id"], current.user_id, current.role, db)
    await db[COLLECTION_GOALS].delete_one({"_id": ObjectId(goal_id)})
    await _recalculate_sheet_totals(goal["goal_sheet_id"], db)
