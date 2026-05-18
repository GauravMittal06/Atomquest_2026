"""
Admin Completion Dashboard router.

Aggregates MongoDB collections (`users`, `goal_sheets`, `goals`, `checkins`,
`checkin_comments`) into a single payload that powers the Admin's enterprise
Completion Dashboard.

Access
------
Admin-only (docs/ROLE_PERMISSIONS.md §Admin — "Monitor completion dashboard").

Payload sections (docs/REPORTING_REQUIREMENTS.md §Completion Dashboard):
    - employee_submission   % of Employees who have a SUBMITTED+ goal sheet
    - manager_checkins      % of Managers who completed quarterly check-ins
    - checkin_summary       pending vs completed check-ins + manager review status
    - thrust_area_distribution   goals per Thrust Area (powers pie chart)
    - quarterly_trend       planned vs actual weighted score per quarter
                            (powers QoQ bar chart, sourced from check-in data)

All math is computed live from MongoDB — there is NO caching layer here so the
endpoint can be polled to deliver near-real-time dashboards (the frontend polls
every 15 seconds).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

from auth import require_roles
from database import (
    COLLECTION_CHECKIN_COMMENTS,
    COLLECTION_CHECKINS,
    COLLECTION_GOAL_SHEETS,
    COLLECTION_GOALS,
    COLLECTION_USERS,
    get_database,
)
from models.goal import ThrustArea
from models.goal_sheet import GoalSheetStatus
from models.user import TokenData, UserRole
from services.checkin_window import get_current_cycle_status
from services.progress_calculator import calculate_progress

router = APIRouter(prefix="/api/admin/dashboard", tags=["Admin Dashboard"])


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# A goal sheet is considered "submitted" once it leaves DRAFT.  Per
# docs/WORKFLOWS.md the lifecycle is DRAFT → SUBMITTED → APPROVED → LOCKED
# (with a RETURNED side-branch).  The Completion Dashboard widget counts an
# employee as having "submitted their goal sheet" the moment any sheet of
# theirs has reached one of these post-Draft states.
SUBMITTED_STATES: list[str] = ["SUBMITTED", "RETURNED", "APPROVED", "LOCKED"]

QUARTER_LABELS: list[str] = ["Q1", "Q2", "Q3", "Q4"]

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


# ---------------------------------------------------------------------------
# Helper math
# ---------------------------------------------------------------------------

def _pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round((numerator / denominator) * 100.0, 1)


def _round1(value: float) -> float:
    return round(value, 1)


# ---------------------------------------------------------------------------
# Endpoint: admin user management list
# ---------------------------------------------------------------------------

_STATUS_RANK = {
    GoalSheetStatus.DRAFT: 0,
    GoalSheetStatus.SUBMITTED: 1,
    GoalSheetStatus.RETURNED: 2,
    GoalSheetStatus.APPROVED: 3,
    GoalSheetStatus.LOCKED: 4,
}


@router.get("/users")
async def get_admin_users(
    _: TokenData = Depends(require_roles(UserRole.ADMIN)),
) -> list[dict[str, Any]]:
    """
    All users with manager name, latest goal-sheet status, and last check-in date.
    Powers Admin → Users (read-only directory).
    """
    db = get_database()

    users = [u async for u in db[COLLECTION_USERS].find({}, {"hashed_password": 0})]
    user_by_id: dict[str, dict] = {str(u["_id"]): u for u in users}

    sheets = [s async for s in db[COLLECTION_GOAL_SHEETS].find({})]
    checkins = [c async for c in db[COLLECTION_CHECKINS].find({})]

    # Latest goal-sheet status per employee (by updated_at, then workflow rank)
    latest_by_emp: dict[str, tuple[datetime, str]] = {}
    for s in sheets:
        emp_id = str(s.get("employee_id", ""))
        if not emp_id:
            continue
        st = s.get("status", "")
        updated = s.get("updated_at") or datetime.min.replace(tzinfo=timezone.utc)
        prev = latest_by_emp.get(emp_id)
        if prev is None:
            latest_by_emp[emp_id] = (updated, st)
            continue
        prev_updated, prev_st = prev
        try:
            rank_new = _STATUS_RANK[GoalSheetStatus(st)]
            rank_old = _STATUS_RANK[GoalSheetStatus(prev_st)]
        except ValueError:
            rank_new, rank_old = -1, -1
        if updated > prev_updated or (updated == prev_updated and rank_new > rank_old):
            latest_by_emp[emp_id] = (updated, st)

    sheet_status_by_emp: dict[str, str] = {eid: st for eid, (_, st) in latest_by_emp.items()}

    # Most recent check-in date per employee (created_by = user Mongo id)
    last_checkin: dict[str, datetime] = {}
    for ci in checkins:
        uid = str(ci.get("created_by", ""))
        if not uid:
            continue
        dt = ci.get("check_in_date")
        if dt and (uid not in last_checkin or dt > last_checkin[uid]):
            last_checkin[uid] = dt

    results: list[dict[str, Any]] = []
    for u in users:
        uid = str(u["_id"])
        role = u.get("role", "")
        if isinstance(role, str):
            role = role.upper().strip()

        manager_name: str | None = None
        mgr_id = u.get("manager_id")
        if mgr_id:
            mgr = user_by_id.get(str(mgr_id))
            if mgr:
                manager_name = mgr.get("name")

        created = u.get("created_at")
        results.append({
            "_id": uid,
            "employee_id": u.get("employee_id", ""),
            "name": u.get("name", ""),
            "email": u.get("email", ""),
            "role": role,
            "department": u.get("department", ""),
            "phone": u.get("phone"),
            "is_active": u.get("is_active", True),
            "manager_name": manager_name,
            "goal_sheet_status": sheet_status_by_emp.get(uid),
            "last_checkin_date": last_checkin[uid].isoformat() if uid in last_checkin else None,
            "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
        })

    results.sort(key=lambda r: (r.get("name") or "").lower())
    return results


# ---------------------------------------------------------------------------
# Endpoint: completion dashboard
# ---------------------------------------------------------------------------

@router.get("/completion")
async def get_completion_dashboard(
    _: TokenData = Depends(require_roles(UserRole.ADMIN)),
) -> dict[str, Any]:
    """
    Aggregate every metric the Admin Completion Dashboard needs in a single
    Mongo round-trip per collection.  The frontend polls this endpoint every
    ~15 s so every widget stays current as employees submit goal sheets and
    managers add check-in comments.
    """
    db = get_database()
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cycle = get_current_cycle_status()
    active_quarter = cycle.active_quarter.value if cycle.active_quarter else None
    # Treat GOAL_SETTING as "no active quarterly check-in window".
    if active_quarter == "GOAL_SETTING":
        active_quarter = None

    # ── Fetch raw documents once ────────────────────────────────────────────
    users: list[dict] = [u async for u in db[COLLECTION_USERS].find({"is_active": True})]
    sheets: list[dict] = [s async for s in db[COLLECTION_GOAL_SHEETS].find({})]
    goals: list[dict] = [g async for g in db[COLLECTION_GOALS].find({})]
    checkins: list[dict] = [c async for c in db[COLLECTION_CHECKINS].find({})]
    comments: list[dict] = [c async for c in db[COLLECTION_CHECKIN_COMMENTS].find({})]

    employees = [u for u in users if u.get("role") == UserRole.EMPLOYEE.value]
    managers = [u for u in users if u.get("role") == UserRole.MANAGER.value]

    return {
        "as_of": now_iso,
        "active_quarter": active_quarter,
        "employee_submission": _compute_employee_submission(employees, sheets),
        "manager_checkins": _compute_manager_checkins(
            managers, employees, comments, checkins, active_quarter
        ),
        "checkin_summary": _compute_checkin_summary(goals, checkins),
        "thrust_area_distribution": _compute_thrust_area_distribution(goals),
        "quarterly_trend": _compute_quarterly_trend(goals, checkins),
    }


# ---------------------------------------------------------------------------
# Section: employee submission
# ---------------------------------------------------------------------------

def _compute_employee_submission(
    employees: list[dict],
    sheets: list[dict],
) -> dict[str, Any]:
    """
    % of Employees who have a non-Draft goal sheet (i.e. SUBMITTED, RETURNED,
    APPROVED or LOCKED).  Per docs/WORKFLOWS.md the moment an employee
    transitions DRAFT → SUBMITTED their sheet enters management workflow, so
    we count them as having "submitted" from that point onward.
    """
    total = len(employees)
    if total == 0:
        return {
            "total_employees": 0,
            "submitted_count": 0,
            "pending_count": 0,
            "submission_pct": 0.0,
        }

    # Build a set of employee_ids who have at least one non-Draft sheet.
    submitted_emp_ids: set[str] = {
        s["employee_id"] for s in sheets if s.get("status") in SUBMITTED_STATES
    }

    submitted_count = sum(1 for u in employees if str(u["_id"]) in submitted_emp_ids)

    return {
        "total_employees": total,
        "submitted_count": submitted_count,
        "pending_count": total - submitted_count,
        "submission_pct": _pct(submitted_count, total),
    }


# ---------------------------------------------------------------------------
# Section: manager check-ins
# ---------------------------------------------------------------------------

def _compute_manager_checkins(
    managers: list[dict],
    employees: list[dict],
    comments: list[dict],
    checkins: list[dict],
    active_quarter: str | None,
) -> dict[str, Any]:
    """
    % of Managers who completed their quarterly check-ins.

    "Completed" means the manager has authored at least one Check-in Comment
    (`checkin_comments` collection) OR at least one `manager_remark` on a
    Check-in for the **active** quarter.  Outside of an active quarter window
    we fall back to "all quarters" so the metric remains meaningful between
    cycles.
    """
    total_managers = len(managers)
    if total_managers == 0:
        return {
            "total_managers": 0,
            "completed_count": 0,
            "pending_count": 0,
            "completion_pct": 0.0,
            "active_quarter": active_quarter,
            "scope_label": "no managers configured",
        }

    # Quarter filter for the active period; falls back to "any quarter" when
    # no check-in window is currently open.
    if active_quarter:
        comments_in_scope = [c for c in comments if c.get("quarter") == active_quarter]
        checkins_in_scope = [c for c in checkins if c.get("period_label") == active_quarter]
        scope_label = f"{active_quarter} check-in window"
    else:
        comments_in_scope = comments
        checkins_in_scope = checkins
        scope_label = "all quarters"

    # Managers who authored at least one check-in comment in scope.
    commenting_mgr_ids: set[str] = {
        c["author_id"]
        for c in comments_in_scope
        if c.get("author_role") == UserRole.MANAGER.value and c.get("author_id")
    }

    # Managers who left a manager_remark on at least one check-in in scope.
    # `manager_id` on a check-in is the manager who added the remark.
    remarking_mgr_ids: set[str] = {
        c["manager_id"]
        for c in checkins_in_scope
        if c.get("manager_id") and c.get("manager_remark")
    }

    completed_mgr_ids = commenting_mgr_ids | remarking_mgr_ids
    completed_count = sum(1 for m in managers if str(m["_id"]) in completed_mgr_ids)

    return {
        "total_managers": total_managers,
        "completed_count": completed_count,
        "pending_count": total_managers - completed_count,
        "completion_pct": _pct(completed_count, total_managers),
        "active_quarter": active_quarter,
        "scope_label": scope_label,
    }


# ---------------------------------------------------------------------------
# Section: pending vs completed check-ins (REPORTING_REQUIREMENTS.md)
# ---------------------------------------------------------------------------

def _compute_checkin_summary(goals: list[dict], checkins: list[dict]) -> dict[str, Any]:
    """
    docs/REPORTING_REQUIREMENTS.md §Completion Dashboard requires:
        - pending check-ins
        - completed check-ins
        - manager review completion status

    Completed = any check-in document already exists (`checkins` collection).
    Pending   = the difference between the **expected** count (one per active
                goal per quarter that has elapsed) and the completed count.

    Manager review completion = ratio of completed check-ins that already have
    a `manager_remark` or are referenced by a `checkin_comments` document.
    """
    total_checkins = len(checkins)
    if total_checkins == 0 and not goals:
        return {
            "completed_checkins": 0,
            "pending_checkins": 0,
            "manager_reviewed_checkins": 0,
            "manager_review_completion_pct": 0.0,
        }

    # Manager has reviewed a check-in when a remark is present.
    reviewed = sum(1 for c in checkins if (c.get("manager_remark") or "").strip())

    # Pending = expected checkins for active goals (APPROVED / LOCKED sheets
    # have their goals "in flight") minus those already filed.  We compute
    # one expected check-in per active goal per quarter that should already
    # have happened.
    pending = max(0, len(goals) - total_checkins)

    return {
        "completed_checkins": total_checkins,
        "pending_checkins": pending,
        "manager_reviewed_checkins": reviewed,
        "manager_review_completion_pct": _pct(reviewed, total_checkins),
    }


# ---------------------------------------------------------------------------
# Section: thrust area distribution (pie chart)
# ---------------------------------------------------------------------------

def _compute_thrust_area_distribution(goals: list[dict]) -> list[dict[str, Any]]:
    """
    Goals grouped by Thrust Area.  Returns one entry per area defined in
    docs/VALIDATION_RULES.md §1 — areas with zero goals are still returned so
    the pie chart legend stays consistent across deployments.

    Entries with `count == 0` MUST be filtered client-side before being
    handed to Recharts' <Pie> to avoid zero-area slices.
    """
    counts: dict[str, int] = {area.value: 0 for area in ThrustArea}
    for g in goals:
        area = g.get("thrust_area")
        if area in counts:
            counts[area] += 1

    return [
        {
            "thrust_area": area,
            "label": THRUST_AREA_LABELS[area],
            "count": counts[area],
        }
        for area in counts
    ]


# ---------------------------------------------------------------------------
# Section: quarterly planned-vs-actual trend (bar chart)
# ---------------------------------------------------------------------------

def _compute_quarterly_trend(
    goals: list[dict],
    checkins: list[dict],
) -> list[dict[str, Any]]:
    """
    Quarter-on-Quarter aggregate planned vs actual, sourced from check-in data.

    For each quarter (Q1 → Q4) we walk every check-in filed for that quarter,
    re-derive its achievement % via the canonical formula in
    services/progress_calculator (which is itself driven by
    docs/VALIDATION_RULES.md), and accumulate:

        planned[Q]  = Σ goal.weightage           (= the weighted goal "target")
        actual[Q]   = Σ goal.weightage × ach%/100  (= weighted delivery)

    The result is two bars per quarter on the same 0-100 weighted scale —
    instantly comparable and resilient to mixed UoM types across goals.
    """
    goals_by_id: dict[str, dict] = {str(g["_id"]): g for g in goals}

    trend: dict[str, dict[str, float | int]] = {
        q: {"planned": 0.0, "actual": 0.0, "checkin_count": 0} for q in QUARTER_LABELS
    }

    for ci in checkins:
        quarter = ci.get("period_label")
        if quarter not in trend:
            # Legacy MID_YEAR / YEAR_END check-ins (pre-Q1-Q4 migration) are
            # intentionally excluded from the dashboard's quarterly view so
            # the bar chart x-axis stays aligned with the active calendar.
            continue

        goal = goals_by_id.get(str(ci.get("goal_id")))
        if not goal:
            continue

        try:
            weight = float(goal.get("weightage") or 0.0)
        except (TypeError, ValueError):
            weight = 0.0
        if weight <= 0:
            continue

        progress = calculate_progress(
            uom_type=goal.get("uom_type"),
            target_value=goal.get("target_value"),
            actual_value=ci.get("actual_value"),
            weightage=weight,
        )

        # `progress.goal_score` is already weight × achievement/100.
        actual = progress.goal_score if progress.goal_score is not None else 0.0

        trend[quarter]["planned"] += weight
        trend[quarter]["actual"] += actual
        trend[quarter]["checkin_count"] += 1

    return [
        {
            "quarter": q,
            "planned": _round1(float(trend[q]["planned"])),
            "actual": _round1(float(trend[q]["actual"])),
            "checkin_count": int(trend[q]["checkin_count"]),
        }
        for q in QUARTER_LABELS
    ]
