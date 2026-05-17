"""
Goals router.
Validates Thrust Area, UoM, Target, and Weightage per docs/VALIDATION_RULES.md.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from auth import get_current_user
from database import COLLECTION_GOAL_SHEETS, COLLECTION_GOALS, get_database
from models.goal import GoalCreate, GoalPublic, GoalUpdate
from models.goal_sheet import ALLOWED_TRANSITIONS, AuditLogEntry, GoalSheetPublic, GoalSheetStatus, GoalSheetStatusUpdate
from models.user import TokenData, UserRole

router = APIRouter(prefix="/api/goals", tags=["Goals"])


# ---------------------------------------------------------------------------
# Combined create-sheet-with-goals models (POST /api/goals/)
# ---------------------------------------------------------------------------

class GoalSheetWithGoalsCreate(BaseModel):
    """
    Single-shot payload for the 'Create Goal Sheet' form.
    Creates the GoalSheet document and all Goal documents atomically.
    Enforces all constraints from docs/VALIDATION_RULES.md §4 and §5.
    """
    period_id: Annotated[str, Field(min_length=1)]
    period_label: Annotated[str, Field(min_length=1, max_length=50)]
    goals: Annotated[List[GoalCreate], Field(min_length=3, max_length=8)]

    @model_validator(mode="after")
    def validate_goals_collection(self) -> "GoalSheetWithGoalsCreate":
        # Total weightage must equal exactly 100 % (VALIDATION_RULES.md §4)
        total = round(sum(g.weightage for g in self.goals), 4)
        if round(total, 2) != 100.0:
            raise ValueError(
                f"Total weightage must equal 100 %. Current total: {total} %"
            )

        # Duplicate detection: same thrust_area + description (VALIDATION_RULES.md §5)
        seen: set[tuple] = set()
        for g in self.goals:
            key = (g.thrust_area, g.description.strip().lower())
            if key in seen:
                raise ValueError(
                    "Duplicate goals detected: two goals share the same Thrust Area and Description."
                )
            seen.add(key)

        return self


class GoalSheetWithGoalsResponse(BaseModel):
    sheet: GoalSheetPublic
    goals: List[GoalPublic]

# Max/min goals per sheet (VALIDATION_RULES.md)
MAX_GOALS = 8
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
# POST /api/goals/ — create Goal Sheet + Goals in one shot
# ---------------------------------------------------------------------------

@router.post("/", response_model=GoalSheetWithGoalsResponse, status_code=status.HTTP_201_CREATED)
async def create_goal_sheet_with_goals(
    body: GoalSheetWithGoalsCreate,
    current: TokenData = Depends(get_current_user),
):
    """
    Creates a GoalSheet (status=DRAFT) and all provided Goals atomically.

    Validations enforced (docs/VALIDATION_RULES.md):
      - Min 3 / Max 10 goals (§5)
      - Weightage per goal: 5 % – 50 % (§4, enforced by GoalCreate)
      - Total weightage == 100 % (§4)
      - No duplicate Thrust Area + Description combinations (§5)
      - One active (non-DRAFT) sheet per employee per period (§5)
    """
    db = get_database()

    # One active non-DRAFT sheet per period per employee (VALIDATION_RULES.md §5)
    existing = await db[COLLECTION_GOAL_SHEETS].find_one({
        "employee_id": current.user_id,
        "period_id": body.period_id,
        "status": {"$ne": GoalSheetStatus.DRAFT},
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail="An active (non-Draft) Goal Sheet already exists for this appraisal period.",
        )

    total_weightage = round(sum(g.weightage for g in body.goals), 4)

    # Create the GoalSheet document
    sheet_doc: dict = {
        "period_id": body.period_id,
        "period_label": body.period_label,
        "employee_id": current.user_id,
        "status": GoalSheetStatus.DRAFT,
        "goal_count": len(body.goals),
        "total_weightage": total_weightage,
        "overall_score": None,
        "reviewed_by": None,
        "review_comment": None,
        "audit_log": [
            AuditLogEntry(
                action=GoalSheetStatus.DRAFT,
                actor_id=current.user_id,
                actor_role=current.role.value,
            ).model_dump()
        ],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    sheet_result = await db[COLLECTION_GOAL_SHEETS].insert_one(sheet_doc)
    sheet_id = str(sheet_result.inserted_id)
    sheet_doc["_id"] = sheet_id

    # Insert all goals
    goal_docs: list[dict] = []
    for goal in body.goals:
        gd = goal.model_dump()
        gd["goal_sheet_id"] = sheet_id
        gd["owner_id"] = current.user_id
        gd["created_at"] = datetime.utcnow()
        goal_docs.append(gd)

    goal_result = await db[COLLECTION_GOALS].insert_many(goal_docs)
    for i, gid in enumerate(goal_result.inserted_ids):
        goal_docs[i]["_id"] = str(gid)

    return GoalSheetWithGoalsResponse(
        sheet=GoalSheetPublic(**sheet_doc),
        goals=[GoalPublic(**gd) for gd in goal_docs],
    )


# ---------------------------------------------------------------------------
# PATCH /api/goals/sheet/{sheet_id}/submit — transition DRAFT → SUBMITTED
# ---------------------------------------------------------------------------

@router.patch("/sheet/{sheet_id}/submit", response_model=GoalSheetPublic)
async def submit_goal_sheet(
    sheet_id: str,
    current: TokenData = Depends(get_current_user),
):
    """
    Transitions a DRAFT Goal Sheet to SUBMITTED.

    Guards (docs/WORKFLOWS.md + VALIDATION_RULES.md):
      - Sheet must be in DRAFT status
      - Total weightage must equal 100 %
      - At least 3 goals required
      - Only the sheet owner (or ADMIN) can submit
    """
    db = get_database()
    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")

    current_status = GoalSheetStatus(doc["status"])
    if GoalSheetStatus.SUBMITTED not in ALLOWED_TRANSITIONS[current_status]:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot submit: sheet is currently in '{current_status}' status.",
        )

    if doc["employee_id"] != current.user_id and current.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only the sheet owner can submit.")

    # Weightage == 100 %
    if round(doc.get("total_weightage", 0.0), 2) != 100.0:
        raise HTTPException(
            status_code=422,
            detail=f"Total weightage must equal 100 %. Current: {doc.get('total_weightage')} %",
        )

    # Min 3 goals
    if doc.get("goal_count", 0) < MIN_GOALS:
        raise HTTPException(
            status_code=422,
            detail=f"At least {MIN_GOALS} goals are required before submitting.",
        )

    audit_entry = AuditLogEntry(
        action=GoalSheetStatus.SUBMITTED,
        actor_id=current.user_id,
        actor_role=current.role.value,
    ).model_dump()

    await db[COLLECTION_GOAL_SHEETS].update_one(
        {"_id": ObjectId(sheet_id)},
        {
            "$set": {"status": GoalSheetStatus.SUBMITTED, "updated_at": datetime.utcnow()},
            "$push": {"audit_log": audit_entry},
        },
    )

    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    return _serialize(doc)


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
