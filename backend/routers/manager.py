"""
Manager-specific endpoints.
Enforces manager access control and team visibility.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, List, Optional
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from auth import get_current_user, require_roles
from database import COLLECTION_GOAL_SHEETS, COLLECTION_USERS, get_database
from models.user import TokenData, UserRole

router = APIRouter(prefix="/api/manager", tags=["Manager"])


def _serialize(doc: dict) -> dict:
    """Convert MongoDB ObjectId fields to strings."""
    if not doc:
        return doc
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    if "employee_id" in doc and doc["employee_id"] is not None:
        doc["employee_id"] = str(doc["employee_id"])
    return doc


@router.get("/approvals")
async def get_manager_approvals(
    status: Optional[str] = Query(None, description="Filter by status: submitted, approved, returned, or comma-separated list"),
    current: TokenData = Depends(require_roles(UserRole.MANAGER, UserRole.ADMIN)),
):
    """
    Get goal sheets requiring manager approval or approval history.
    
    Query params:
    - status: Filter by status (submitted, approved, returned, or comma-separated list like "approved,returned")
    
    For PENDING APPROVALS: status=submitted
    For APPROVAL HISTORY: status=approved,returned
    
    Returns goal sheets with employee information, sorted appropriately:
    - Pending (submitted): by submission_date DESC  
    - History (approved/returned): by action_date DESC
    """
    db = get_database()
    
    # Get manager's team members
    if current.role == UserRole.MANAGER:
        team_members = [
            u async for u in db[COLLECTION_USERS].find(
                {"manager_id": current.user_id}, 
                {"_id": 1, "name": 1, "employee_id": 1, "department": 1}
            )
        ]
        team_ids = [str(member["_id"]) for member in team_members]
        if not team_ids:
            return []
    else:
        # Admin can see all
        team_members = [
            u async for u in db[COLLECTION_USERS].find(
                {"role": "EMPLOYEE"}, 
                {"_id": 1, "name": 1, "employee_id": 1, "department": 1}
            )
        ]
        team_ids = [str(member["_id"]) for member in team_members]
    
    # Create user lookup map
    user_map = {str(member["_id"]): member for member in team_members}
    
    # Parse status filter
    query_filter = {"employee_id": {"$in": team_ids}}
    if status:
        status_list = [s.strip().upper() for s in status.split(",")]
        query_filter["status"] = {"$in": status_list}
    
    # Fetch goal sheets
    cursor = db[COLLECTION_GOAL_SHEETS].find(query_filter)
    sheets = [_serialize(sheet) async for sheet in cursor]
    
    # Enhance with employee data and sort
    results = []
    for sheet in sheets:
        employee = user_map.get(sheet["employee_id"])
        if not employee:
            continue
            
        # Find relevant action date from audit log
        action_date = None
        if sheet["status"] in ["SUBMITTED"]:
            # For submitted, use the submission date (when it moved from DRAFT to SUBMITTED)
            audit_log = sheet.get("audit_log", [])
            for entry in reversed(audit_log):
                if entry.get("action") == "SUBMITTED":
                    action_date = entry.get("timestamp")
                    break
        elif sheet["status"] in ["APPROVED", "RETURNED", "LOCKED"]:
            audit_log = sheet.get("audit_log", [])
            for entry in reversed(audit_log):
                if entry.get("action") in ["APPROVED", "RETURNED", "LOCKED"]:
                    action_date = entry.get("timestamp")
                    break
        
        # Get the reviewer name for history items
        reviewer_name = None
        reviewed_by = sheet.get("reviewed_by")
        if reviewed_by:
            try:
                reviewer = await db[COLLECTION_USERS].find_one(
                    {"_id": ObjectId(reviewed_by)},
                    {"name": 1},
                )
                if reviewer:
                    reviewer_name = reviewer["name"]
            except Exception:
                pass
        
        result = {
            "sheet_id": sheet["_id"],
            "employee_id": sheet["employee_id"],
            "employee_name": employee["name"],
            "employee_code": employee["employee_id"],
            "department": employee["department"],
            "status": sheet["status"],
            "period_label": sheet.get("period_label", ""),
            "goal_count": sheet.get("goal_count", 0),
            "total_weightage": sheet.get("total_weightage", 0),
            "overall_score": sheet.get("overall_score"),
            "action_date": action_date,
            "review_comment": sheet.get("review_comment"),
            "reviewer_name": reviewer_name,
        }
        results.append(result)
    
    # Sort results
    if status and "submitted" in status.lower():
        # Pending approvals: most recent submissions first
        results.sort(key=lambda x: x["action_date"] or datetime.min, reverse=True)
    else:
        # History: most recent actions first
        results.sort(key=lambda x: x["action_date"] or datetime.min, reverse=True)
    
    return results