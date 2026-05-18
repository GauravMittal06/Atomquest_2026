"""
Admin governance endpoints.

GET /api/admin/all-goal-sheets — hierarchical goal-sheet view grouped by employee.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query

from auth import require_roles
from database import (
    COLLECTION_GOAL_SHEETS,
    COLLECTION_GOALS,
    COLLECTION_USERS,
    get_database,
)
from models.goal import ThrustArea
from models.goal_sheet import GoalSheetStatus
from models.user import TokenData, UserRole

router = APIRouter(prefix="/api/admin", tags=["Admin"])

THRUST_AREA_LABELS: dict[str, str] = {
    ThrustArea.INNOVATION_TECHNOLOGY.value: "Innovation & Technology",
    ThrustArea.QUALITY_PROCESS_EXCELLENCE.value: "Quality & Process Excellence",
    ThrustArea.CUSTOMER_SATISFACTION.value: "Customer Satisfaction",
    ThrustArea.DELIVERY_TIMELINESS.value: "Delivery & Timeliness",
    ThrustArea.PEOPLE_DEVELOPMENT.value: "People Development",
    ThrustArea.BUSINESS_GROWTH.value: "Business Growth & Revenue",
    ThrustArea.SAFETY_COMPLIANCE.value: "Safety, Compliance & Risk",
    ThrustArea.COST_OPTIMISATION.value: "Cost Optimisation",
}

_STATUS_ORDER = {
    GoalSheetStatus.DRAFT: 0,
    GoalSheetStatus.SUBMITTED: 1,
    GoalSheetStatus.RETURNED: 2,
    GoalSheetStatus.APPROVED: 3,
    GoalSheetStatus.LOCKED: 4,
}


def _serialize_goal(g: dict) -> dict[str, Any]:
    return {
        "goal_id": str(g["_id"]),
        "thrust_area": g.get("thrust_area", ""),
        "thrust_area_label": THRUST_AREA_LABELS.get(g.get("thrust_area", ""), g.get("thrust_area", "")),
        "description": g.get("description", ""),
        "weightage": g.get("weightage"),
        "achievement_pct": g.get("achievement_pct"),
        "goal_score": g.get("goal_score"),
    }


def _assign_revisions(sheets: list[dict]) -> None:
    """Set revision (1-based) per employee + FY, ordered by created_at."""
    by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for s in sheets:
        by_key[(s["employee_id"], s.get("period_label", ""))].append(s)

    for group in by_key.values():
        group.sort(key=lambda x: x.get("created_at") or datetime.min)
        for idx, s in enumerate(group, start=1):
            s["revision"] = idx


def _latest_sheet(sheets: list[dict]) -> dict | None:
    if not sheets:
        return None
    return max(
        sheets,
        key=lambda s: (
            s.get("updated_at") or datetime.min,
            _STATUS_ORDER.get(GoalSheetStatus(s["status"]), -1),
        ),
    )


@router.get("/all-goal-sheets")
async def get_all_goal_sheets_grouped(
    status: Optional[str] = Query(None, description="Filter by sheet status (e.g. LOCKED)"),
    department: Optional[str] = Query(None, description="Filter by employee department"),
    _: TokenData = Depends(require_roles(UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    Returns all goal sheets grouped by employee for the Admin governance page.

    Optional filters apply at the goal-sheet level; employees with no matching
    sheets after filtering are omitted. Each employee appears exactly once.
    """
    db = get_database()

    users = [u async for u in db[COLLECTION_USERS].find({"is_active": True})]
    user_by_id: dict[str, dict] = {str(u["_id"]): u for u in users}

    all_sheets = [s async for s in db[COLLECTION_GOAL_SHEETS].find({})]
    goals = [g async for g in db[COLLECTION_GOALS].find({})]

    status_counts: dict[str, int] = {st.value: 0 for st in GoalSheetStatus}
    for s in all_sheets:
        st = s.get("status", "")
        if st in status_counts:
            status_counts[st] += 1

    sheets = list(all_sheets)

    goals_by_sheet: dict[str, list[dict]] = defaultdict(list)
    for g in goals:
        goals_by_sheet[str(g.get("goal_sheet_id", ""))].append(g)

    _assign_revisions(sheets)

    # Serialize sheet payloads once
    sheet_payloads: list[dict[str, Any]] = []
    for s in sheets:
        sid = str(s["_id"])
        emp_oid = s.get("employee_id", "")
        emp_user = user_by_id.get(emp_oid, {})
        dept = emp_user.get("department", "")

        if department and dept != department:
            continue

        sheet_status = s.get("status", "")
        if status and status.upper() != "ALL" and sheet_status != status.upper():
            continue

        sheet_payloads.append({
            "sheet_id": sid,
            "employee_oid": emp_oid,
            "fy": s.get("period_label", ""),
            "period_id": s.get("period_id", ""),
            "revision": s.get("revision", 1),
            "status": sheet_status,
            "goals_count": s.get("goal_count", 0),
            "score": s.get("overall_score"),
            "has_admin_unlock": any(
                e.get("action") == "UNLOCKED" for e in (s.get("audit_log") or [])
            ),
            "goals": [_serialize_goal(g) for g in goals_by_sheet.get(sid, [])],
            "updated_at": s.get("updated_at"),
            "created_at": s.get("created_at"),
            "_dept": dept,
        })

    # Group by employee MongoDB id
    by_employee: dict[str, list[dict]] = defaultdict(list)
    for sp in sheet_payloads:
        by_employee[sp.pop("employee_oid")].append(sp)

    employees_out: list[dict[str, Any]] = []

    for emp_oid, emp_sheets in by_employee.items():
        emp_user = user_by_id.get(emp_oid)
        if not emp_user:
            continue

        mgr_name = "—"
        mgr_id = emp_user.get("manager_id")
        if mgr_id:
            mgr = user_by_id.get(mgr_id, {})
            mgr_name = mgr.get("name", mgr_id)

        emp_sheets.sort(
            key=lambda x: (
                x.get("fy", ""),
                x.get("revision", 0),
            ),
        )

        latest_full = _latest_sheet(
            [
                {
                    "status": sp["status"],
                    "overall_score": sp["score"],
                    "updated_at": sp.get("updated_at"),
                }
                for sp in emp_sheets
            ]
        )

        locked_count = sum(1 for sp in emp_sheets if sp["status"] == GoalSheetStatus.LOCKED.value)

        employees_out.append({
            "employee_id": emp_user.get("employee_id", emp_oid),
            "user_id": emp_oid,
            "name": emp_user.get("name", ""),
            "department": emp_user.get("department", ""),
            "manager": mgr_name,
            "latest_status": latest_full["status"] if latest_full else None,
            "latest_score": latest_full.get("overall_score") if latest_full else None,
            "goal_sheet_count": len(emp_sheets),
            "locked_sheet_count": locked_count,
            "goal_sheets": [
                {k: v for k, v in sp.items() if not k.startswith("_")}
                for sp in emp_sheets
            ],
        })

    employees_out.sort(key=lambda e: (e.get("name") or "").lower())

    departments = sorted(
        {e.get("department", "") for e in employees_out if e.get("department")},
    )

    return {
        "employees": employees_out,
        "departments": departments,
        "total_sheets": len(all_sheets),
        "filtered_sheet_count": len(sheet_payloads),
        "status_counts": status_counts,
    }
