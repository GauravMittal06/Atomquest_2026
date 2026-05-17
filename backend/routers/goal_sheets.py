"""
Goal Sheets router.
Enforces workflow state machine from docs/WORKFLOWS.md.
Permission matrix from docs/ROLE_PERMISSIONS.md.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from auth import get_current_user, require_roles
from database import COLLECTION_GOAL_SHEETS, COLLECTION_GOALS, get_database
from models.goal_sheet import (
    ALLOWED_TRANSITIONS,
    AuditLogEntry,
    GoalSheetCreate,
    GoalSheetInDB,
    GoalSheetPublic,
    GoalSheetStatus,
    GoalSheetStatusUpdate,
)
from models.user import TokenData, UserRole

router = APIRouter(prefix="/api/goalsheets", tags=["Goal Sheets"])


def _serialize(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("/", response_model=GoalSheetPublic, status_code=status.HTTP_201_CREATED)
async def create_goal_sheet(
    body: GoalSheetCreate,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()

    # One active sheet per period per employee (VALIDATION_RULES.md §5)
    existing = await db[COLLECTION_GOAL_SHEETS].find_one({
        "employee_id": current.user_id,
        "period_id": body.period_id,
        "status": {"$ne": GoalSheetStatus.DRAFT},
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail="An active (non-Draft) Goal Sheet already exists for this period.",
        )

    doc = body.model_dump()
    doc["employee_id"] = current.user_id
    doc["status"] = GoalSheetStatus.DRAFT
    doc["goal_count"] = 0
    doc["total_weightage"] = 0.0
    doc["audit_log"] = [
        AuditLogEntry(
            action=GoalSheetStatus.DRAFT,
            actor_id=current.user_id,
            actor_role=current.role.value,
        ).model_dump()
    ]
    doc["created_at"] = datetime.utcnow()
    doc["updated_at"] = datetime.utcnow()

    result = await db[COLLECTION_GOAL_SHEETS].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[GoalSheetPublic])
async def list_goal_sheets(
    period_id: Optional[str] = Query(None),
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    query: dict = {}

    if current.role == UserRole.EMPLOYEE:
        query["employee_id"] = current.user_id
    elif current.role == UserRole.MANAGER:
        # Fetch all employees who report to this manager
        team_ids = [
            str(u["_id"])
            async for u in db["users"].find({"manager_id": current.user_id}, {"_id": 1})
        ]
        team_ids.append(current.user_id)
        query["employee_id"] = {"$in": team_ids}
    # ADMIN: no filter (sees all)

    if period_id:
        query["period_id"] = period_id

    cursor = db[COLLECTION_GOAL_SHEETS].find(query)
    return [_serialize(d) async for d in cursor]


@router.get("/{sheet_id}", response_model=GoalSheetPublic)
async def get_goal_sheet(
    sheet_id: str,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")

    if current.role == UserRole.EMPLOYEE and doc["employee_id"] != current.user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return _serialize(doc)


# ---------------------------------------------------------------------------
# State transition
# ---------------------------------------------------------------------------

@router.patch("/{sheet_id}/status", response_model=GoalSheetPublic)
async def update_goal_sheet_status(
    sheet_id: str,
    body: GoalSheetStatusUpdate,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")

    current_status = GoalSheetStatus(doc["status"])
    new_status = body.new_status

    # Validate transition is allowed
    if new_status not in ALLOWED_TRANSITIONS[current_status]:
        raise HTTPException(
            status_code=422,
            detail=f"Transition {current_status} → {new_status} is not permitted.",
        )

    # Permission checks per transition
    if new_status == GoalSheetStatus.SUBMITTED:
        if doc["employee_id"] != current.user_id and current.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Only the sheet owner can submit.")
        # Validate weightage sum == 100 (VALIDATION_RULES.md §4)
        if round(doc.get("total_weightage", 0.0), 2) != 100.0:
            raise HTTPException(
                status_code=422,
                detail=f"Total weightage must equal 100 %. Current: {doc.get('total_weightage')} %",
            )
        # Min 3 goals
        if doc.get("goal_count", 0) < 3:
            raise HTTPException(status_code=422, detail="Goal Sheet must have at least 3 goals.")

    if new_status in (GoalSheetStatus.APPROVED, GoalSheetStatus.RETURNED, GoalSheetStatus.LOCKED):
        if current.role == UserRole.EMPLOYEE:
            raise HTTPException(status_code=403, detail="Employees cannot approve, return, or lock sheets.")

    # Build audit entry
    audit_entry = AuditLogEntry(
        action=new_status,
        actor_id=current.user_id,
        actor_role=current.role.value,
        comment=body.comment,
    ).model_dump()

    update: dict = {
        "status": new_status,
        "updated_at": datetime.utcnow(),
        "$push": {"audit_log": audit_entry},
    }
    if new_status in (GoalSheetStatus.APPROVED, GoalSheetStatus.RETURNED):
        update["reviewed_by"] = current.user_id
        update["review_comment"] = body.comment

    # Flatten $push and $set so they don't conflict
    push_op = update.pop("$push")
    await db[COLLECTION_GOAL_SHEETS].update_one(
        {"_id": ObjectId(sheet_id)},
        {"$set": update, "$push": push_op},
    )

    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    return _serialize(doc)


# ---------------------------------------------------------------------------
# Delete (DRAFT only)
# ---------------------------------------------------------------------------

@router.delete("/{sheet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal_sheet(
    sheet_id: str,
    current: TokenData = Depends(get_current_user),
):
    db = get_database()
    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")
    if doc["status"] != GoalSheetStatus.DRAFT:
        raise HTTPException(status_code=422, detail="Only DRAFT Goal Sheets can be deleted.")
    if doc["employee_id"] != current.user_id and current.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Access denied.")

    await db[COLLECTION_GOAL_SHEETS].delete_one({"_id": ObjectId(sheet_id)})
    await db[COLLECTION_GOALS].delete_many({"goal_sheet_id": sheet_id})


# ---------------------------------------------------------------------------
# Manager L1: Approve — SUBMITTED → APPROVED → LOCKED (atomic, two audit entries)
# Source: docs/WORKFLOWS.md §Goal Lifecycle, docs/ROLE_PERMISSIONS.md §Manager
# ---------------------------------------------------------------------------

@router.patch("/{sheet_id}/approve", response_model=GoalSheetPublic)
async def manager_approve_goal_sheet(
    sheet_id: str,
    current: TokenData = Depends(require_roles(UserRole.MANAGER, UserRole.ADMIN)),
):
    """
    Manager L1 (or Admin) approves a SUBMITTED Goal Sheet.

    Workflow (docs/WORKFLOWS.md): SUBMITTED → APPROVED → LOCKED
    Both transitions are recorded as separate audit-log entries in one
    atomic DB write so the history remains complete.

    Guards:
      - Caller must be MANAGER or ADMIN
      - Sheet must be in SUBMITTED status
      - MANAGER callers: employee must report to this manager (manager_id)
      - Total weightage must equal exactly 100 % (VALIDATION_RULES.md §4)
    """
    db = get_database()
    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")

    if GoalSheetStatus(doc["status"]) != GoalSheetStatus.SUBMITTED:
        raise HTTPException(
            status_code=422,
            detail="Only SUBMITTED Goal Sheets can be approved.",
        )

    # Manager access: employee must report to this manager
    if current.role == UserRole.MANAGER:
        employee = await db["users"].find_one({"_id": ObjectId(doc["employee_id"])})
        if not employee or employee.get("manager_id") != current.user_id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: this employee does not report to you.",
            )

    # Weightage == 100 % (VALIDATION_RULES.md §4)
    if round(doc.get("total_weightage", 0.0), 2) != 100.0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Total weightage must equal 100 % before approving. "
                f"Current: {doc.get('total_weightage')} %"
            ),
        )

    now = datetime.utcnow()

    # Two audit entries: APPROVED then LOCKED — both recorded atomically
    approved_entry = AuditLogEntry(
        action=GoalSheetStatus.APPROVED,
        actor_id=current.user_id,
        actor_role=current.role.value,
        timestamp=now,
    ).model_dump()
    locked_entry = AuditLogEntry(
        action=GoalSheetStatus.LOCKED,
        actor_id=current.user_id,
        actor_role=current.role.value,
        timestamp=now,
    ).model_dump()

    await db[COLLECTION_GOAL_SHEETS].update_one(
        {"_id": ObjectId(sheet_id)},
        {
            "$set": {
                "status": GoalSheetStatus.LOCKED,
                "reviewed_by": current.user_id,
                "updated_at": now,
            },
            "$push": {"audit_log": {"$each": [approved_entry, locked_entry]}},
        },
    )

    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    return _serialize(doc)
