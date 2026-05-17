"""
Manager Check-in Comments router.

Backs the structured "Check-in Comment" panel on the Manager review screen.

Storage shape (docs/REPORTING_REQUIREMENTS.md §Audit Log Rules + brief):
  - author_id, author_role, author_name (snapshot)
  - created_at  (UTC timestamp)
  - quarter     (Q1 / Q2 / Q3 / Q4)
  - goal_sheet_id, employee_id
  - comment

Permissions (docs/ROLE_PERMISSIONS.md):
  - Managers: may comment on their own team's sheets
  - Admins: may comment on any sheet
  - Employees: read-only on their own sheet's comments
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user, require_roles
from database import (
    COLLECTION_CHECKIN_COMMENTS,
    COLLECTION_GOAL_SHEETS,
    COLLECTION_USERS,
    get_database,
)
from models.checkin_comment import CheckinCommentCreate, CheckinCommentPublic
from models.user import TokenData, UserRole

router = APIRouter(prefix="/api/checkin-comments", tags=["Check-in Comments"])


def _serialize(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


async def _assert_manager_owns_employee(manager_id: str, employee_id: str, db) -> None:
    employee = await db[COLLECTION_USERS].find_one({"_id": ObjectId(employee_id)})
    if not employee or employee.get("manager_id") != manager_id:
        raise HTTPException(
            status_code=403,
            detail="Access denied: this employee does not report to you.",
        )


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("/", response_model=CheckinCommentPublic, status_code=201)
async def create_comment(
    body: CheckinCommentCreate,
    current: TokenData = Depends(require_roles(UserRole.MANAGER, UserRole.ADMIN)),
):
    db = get_database()

    sheet = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(body.goal_sheet_id)})
    if not sheet:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")
    if sheet["employee_id"] != body.employee_id:
        raise HTTPException(
            status_code=422,
            detail="employee_id does not match the Goal Sheet owner.",
        )

    if current.role == UserRole.MANAGER:
        await _assert_manager_owns_employee(current.user_id, body.employee_id, db)

    author = await db[COLLECTION_USERS].find_one({"_id": ObjectId(current.user_id)})
    author_name = author.get("name") if author else None

    doc: dict = {
        "goal_sheet_id": body.goal_sheet_id,
        "employee_id": body.employee_id,
        "quarter": body.quarter.value,
        "comment": body.comment.strip(),
        "author_id": current.user_id,
        "author_role": current.role.value,
        "author_name": author_name,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db[COLLECTION_CHECKIN_COMMENTS].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[CheckinCommentPublic])
async def list_comments(
    goal_sheet_id: str = Query(..., min_length=1),
    quarter: str | None = Query(None),
    current: TokenData = Depends(get_current_user),
):
    """List comments for a sheet (most recent first)."""
    db = get_database()
    sheet = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(goal_sheet_id)})
    if not sheet:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")

    # Permission: employee can only see comments on their own sheet
    if current.role == UserRole.EMPLOYEE and sheet["employee_id"] != current.user_id:
        raise HTTPException(status_code=403, detail="Access denied.")
    if current.role == UserRole.MANAGER:
        await _assert_manager_owns_employee(current.user_id, sheet["employee_id"], db)

    query: dict = {"goal_sheet_id": goal_sheet_id}
    if quarter:
        query["quarter"] = quarter

    cursor = db[COLLECTION_CHECKIN_COMMENTS].find(query).sort("created_at", -1)
    return [_serialize(d) async for d in cursor]
