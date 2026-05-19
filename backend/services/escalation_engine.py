"""
Escalation Engine Service.

Implements the automatic escalation detection and promotion logic defined in
docs/ESCALATION_RULES.md. This service scans all goal sheets and creates/promotes
escalations based on three triggers:

1. SUBMISSION_DELAY: Draft goal sheets not submitted within 7 days
2. APPROVAL_DELAY: Submitted goal sheets not approved/returned within 5 days
3. CHECKIN_DELAY: Missing actuals after quarterly check-in window closes

Level 1 escalations that remain active for > 3 days are promoted to Level 2.

This module provides only the engine logic — no HTTP routes are defined here.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId

from database import get_database
from models.check_in import PeriodLabel
from models.goal_sheet import GoalSheetStatus
from services.checkin_window import QUARTER_WINDOW_SCHEDULE, QuarterId
from services.mock_time import get_current_date


COLLECTION_ESCALATIONS = "escalations"
COLLECTION_GOAL_SHEETS = "goal_sheets"
COLLECTION_USERS = "users"
COLLECTION_CHECKINS = "checkins"


# ---------------------------------------------------------------------------
# Trigger type constants (from ESCALATION_RULES.md)
# ---------------------------------------------------------------------------

class TriggerType:
    SUBMISSION_DELAY = "SUBMISSION_DELAY"
    APPROVAL_DELAY = "APPROVAL_DELAY"
    CHECKIN_DELAY = "CHECKIN_DELAY"


class EscalationStatus:
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _get_submitted_at(goal_sheet: dict[str, Any]) -> Optional[datetime]:
    """
    Extract the timestamp when the goal sheet was submitted.
    
    Per ESCALATION_RULES.md §Trigger 2, prefer the most recent audit_log entry
    with action == "SUBMITTED", or fall back to updated_at.
    """
    audit_log = goal_sheet.get("audit_log", [])
    
    for entry in reversed(audit_log):
        if entry.get("action") == "SUBMITTED":
            return entry.get("timestamp")
    
    return goal_sheet.get("updated_at")


def _get_closed_quarters(now: datetime) -> list[tuple[PeriodLabel, datetime]]:
    """
    Return list of (period_label, window_close_date) for quarters that have closed
    as of the given date.
    
    Per ESCALATION_RULES.md §Trigger 3, evaluation runs on the first day after
    the window's closing month ends.
    
    Returns quarters where now >= first_day_after_window_close.
    """
    closed = []
    
    for quarter_id, opens_month, closes_month in QUARTER_WINDOW_SCHEDULE:
        if quarter_id == QuarterId.GOAL_SETTING:
            continue
        
        # Calculate the last day of the closing month
        # The window closes at the end of closes_month
        # Evaluation happens on the first day after: closes_month + 1, day 1
        
        # For the current appraisal year cycle
        year = now.year
        
        # Adjust year based on month (January is in the next calendar year for FY cycle)
        if closes_month >= 7:
            check_year = year
        else:
            check_year = year + 1
        
        # The window closes on the last day of closes_month
        # Evaluation starts on the first day of (closes_month + 1)
        eval_month = closes_month + 1
        eval_year = check_year
        
        if eval_month > 12:
            eval_month = 1
            eval_year += 1
        
        # First day after window close
        window_close_eval_date = datetime(eval_year, eval_month, 1, tzinfo=timezone.utc)
        
        # Only include quarters where evaluation date has passed
        if now >= window_close_eval_date:
            # Map QuarterId to PeriodLabel
            period_label = PeriodLabel[quarter_id.value]
            closed.append((period_label, window_close_eval_date))
    
    return closed


async def _has_actuals_for_period(
    db: Any,
    goal_sheet_id: str,
    employee_id: str,
    period_label: PeriodLabel,
) -> bool:
    """
    Check if the employee has logged at least one actual value for the given period.
    
    Per ESCALATION_RULES.md §Trigger 3:
    - Must have a check_in document with matching goal_sheet_id, period_label, created_by
    - Must have actual_value present and non-null
    - Empty string, missing field, or placeholder-only rows do NOT count
    """
    checkin = await db[COLLECTION_CHECKINS].find_one({
        "goal_sheet_id": goal_sheet_id,
        "period_label": period_label.value,
        "created_by": employee_id,
        "actual_value": {"$exists": True, "$ne": None, "$ne": ""},
    })
    
    return checkin is not None


async def _get_or_create_escalation(
    db: Any,
    goal_sheet_id: str,
    employee_id: str,
    manager_id: str,
    trigger_type: str,
    now: datetime,
    period_label: Optional[str] = None,
) -> tuple[dict[str, Any], bool]:
    """
    Get existing ACTIVE escalation or create a new one.
    
    Returns (escalation_doc, is_new).
    
    Per ESCALATION_RULES.md §Idempotency:
    - At most one ACTIVE escalation per (goal_sheet_id, trigger_type)
    - For CHECKIN_DELAY, also includes period_label in uniqueness check
    """
    query = {
        "goal_sheet_id": goal_sheet_id,
        "trigger_type": trigger_type,
        "status": EscalationStatus.ACTIVE,
    }
    
    if trigger_type == TriggerType.CHECKIN_DELAY and period_label:
        query["resolution_notes"] = {"$regex": f"^Missed {period_label}"}
    
    existing = await db[COLLECTION_ESCALATIONS].find_one(query)
    
    if existing:
        return existing, False
    
    escalation_doc = {
        "escalation_id": str(uuid.uuid4()),
        "goal_sheet_id": goal_sheet_id,
        "employee_id": employee_id,
        "manager_id": manager_id,
        "trigger_type": trigger_type,
        "level": 1,
        "status": EscalationStatus.ACTIVE,
        "created_at": now,
        "resolved_at": None,
        "resolution_notes": None,
        "audit_log": [
            {
                "action": "CREATED",
                "timestamp": now,
                "actor_id": "system",
            }
        ],
    }
    
    if trigger_type == TriggerType.CHECKIN_DELAY and period_label:
        escalation_doc["resolution_notes"] = f"Missed {period_label} check-in window."
    
    await db[COLLECTION_ESCALATIONS].insert_one(escalation_doc)
    
    return escalation_doc, True


# ---------------------------------------------------------------------------
# Main engine function
# ---------------------------------------------------------------------------

async def run_escalation_engine() -> dict[str, int]:
    """
    Scan all goal sheets and evaluate escalation triggers.
    
    This function implements the escalation detection and promotion logic
    defined in docs/ESCALATION_RULES.md. It:
    
    1. Evaluates SUBMISSION_DELAY for DRAFT sheets > 7 days old
    2. Evaluates APPROVAL_DELAY for SUBMITTED sheets > 5 days old
    3. Evaluates CHECKIN_DELAY for LOCKED sheets with missing actuals
    4. Promotes Level 1 escalations > 3 days old to Level 2
    
    The function is idempotent: running it multiple times will not create
    duplicate escalations for the same condition.
    
    Returns:
        dict: Statistics about escalations processed:
            - submission_delay_count: New SUBMISSION_DELAY escalations created
            - approval_delay_count: New APPROVAL_DELAY escalations created
            - checkin_delay_count: New CHECKIN_DELAY escalations created
            - level_2_promotions: Number of Level 1 → Level 2 promotions
            - total_active: Total number of ACTIVE escalations after run
    """
    print("DEBUG: Starting escalation check")
    db = get_database()
    print("DEBUG: Database connection obtained")
    now = await get_current_date()
    print(f"DEBUG: Current mock date is {now}")

    def make_aware(dt):
        """Convert naive datetime to UTC-aware."""
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    
    stats = {
        "submission_delay_count": 0,
        "approval_delay_count": 0,
        "checkin_delay_count": 0,
        "level_2_promotions": 0,
        "total_active": 0,
    }
    
    # ---------------------------------------------------------------------------
    # 1. Evaluate SUBMISSION_DELAY
    # ---------------------------------------------------------------------------
    print("DEBUG: Scanning goal sheets for SUBMISSION_DELAY...")
    
    # Find all DRAFT goal sheets for the current appraisal period
    # that are > 7 days old
    seven_days_ago = now.timestamp() - (7 * 24 * 60 * 60)
    seven_days_ago_dt = datetime.fromtimestamp(seven_days_ago, tz=timezone.utc)
    print(f"DEBUG: SUBMISSION_DELAY cutoff date is {seven_days_ago_dt}")

    goal_sheets = await db[COLLECTION_GOAL_SHEETS].find({
        "status": GoalSheetStatus.DRAFT.value,
    }).to_list(length=None)

    print(f"DEBUG SUBMISSION_DELAY:")
    for sheet in goal_sheets:
        created = make_aware(sheet.get("created_at"))
        print(f"  Sheet {sheet['_id']}: created_at={created}, seven_days_ago={seven_days_ago_dt}")
        print(f"    Comparison: {created} < {seven_days_ago_dt} ? {created < seven_days_ago_dt}")

    for sheet in goal_sheets:
        print(f"DEBUG: Checking SUBMISSION_DELAY for goal sheet {sheet.get('_id')}")
        created_at = sheet.get("created_at")
        if not created_at:
            continue
        if make_aware(created_at) < seven_days_ago_dt:
            employee_id = sheet["employee_id"]
            
            user = await db[COLLECTION_USERS].find_one({"_id": ObjectId(employee_id)})
            if not user:
                continue
            
            manager_id = sheet.get("manager_id") or user.get("manager_id")
            if not manager_id:
                continue
            
            manager = await db[COLLECTION_USERS].find_one({"_id": ObjectId(manager_id)})
            if not manager:
                continue
            
            _, is_new = await _get_or_create_escalation(
                db=db,
                goal_sheet_id=str(sheet["_id"]),
                employee_id=employee_id,
                manager_id=str(manager_id),
                trigger_type=TriggerType.SUBMISSION_DELAY,
                now=now,
            )
            
            if is_new:
                stats["submission_delay_count"] += 1
    
    # ---------------------------------------------------------------------------
    # 2. Evaluate APPROVAL_DELAY
    # ---------------------------------------------------------------------------
    print("DEBUG: Checking triggers for APPROVAL_DELAY...")
    
    # Find all SUBMITTED goal sheets where submitted_at is > 5 days ago
    five_days_ago = now.timestamp() - (5 * 24 * 60 * 60)
    five_days_ago_dt = datetime.fromtimestamp(five_days_ago, tz=timezone.utc)
    print(f"DEBUG: APPROVAL_DELAY cutoff date is {five_days_ago_dt}")

    goal_sheets = await db[COLLECTION_GOAL_SHEETS].find({
        "status": GoalSheetStatus.SUBMITTED.value,
    }).to_list(length=None)

    print(f"DEBUG APPROVAL_DELAY:")
    for sheet in goal_sheets:
        submitted = make_aware(sheet.get("audit_log")[-1].get("timestamp") if sheet.get("audit_log") else None)
        print(f"  Sheet {sheet['_id']}: submitted_at={submitted}, five_days_ago={five_days_ago_dt}")
        print(f"    Comparison: {submitted} < {five_days_ago_dt} ? {submitted < five_days_ago_dt if submitted else 'N/A'}")

    for sheet in goal_sheets:
        print(f"DEBUG: Checking APPROVAL_DELAY for goal sheet {sheet.get('_id')}")
        submitted_at = _get_submitted_at(sheet)
        print(f"DEBUG: submitted_at={submitted_at}, tzinfo={getattr(submitted_at, 'tzinfo', None)}")
        
        if not submitted_at:
            continue
        
        if make_aware(submitted_at) < five_days_ago_dt:
            employee_id = sheet["employee_id"]
            
            user = await db[COLLECTION_USERS].find_one({"_id": ObjectId(employee_id)})
            if not user:
                continue
            
            manager_id = sheet.get("manager_id") or user.get("manager_id")
            if not manager_id:
                continue
            
            manager = await db[COLLECTION_USERS].find_one({"_id": ObjectId(manager_id)})
            if not manager:
                continue
            
            _, is_new = await _get_or_create_escalation(
                db=db,
                goal_sheet_id=str(sheet["_id"]),
                employee_id=employee_id,
                manager_id=str(manager_id),
                trigger_type=TriggerType.APPROVAL_DELAY,
                now=now,
            )
            
            if is_new:
                stats["approval_delay_count"] += 1
    
    # ---------------------------------------------------------------------------
    # 3. Evaluate CHECKIN_DELAY
    # ---------------------------------------------------------------------------
    print("DEBUG: Checking triggers for CHECKIN_DELAY...")
    
    # Get list of closed quarters
    closed_quarters = _get_closed_quarters(make_aware(now))
    print(f"DEBUG: Found {len(closed_quarters)} closed quarter(s) to evaluate")
    
    for period_label, _ in closed_quarters:
        print(f"DEBUG: Evaluating CHECKIN_DELAY for period {period_label.value}")
        # Find all LOCKED goal sheets
        locked_sheets = db[COLLECTION_GOAL_SHEETS].find({
            "status": GoalSheetStatus.LOCKED.value,
        })
        
        async for sheet in locked_sheets:
            goal_sheet_id = str(sheet["_id"])
            employee_id = sheet["employee_id"]
            print(f"DEBUG: Checking CHECKIN_DELAY for goal sheet {goal_sheet_id}")
            
            # Check if employee has logged actuals for this period
            has_actuals = await _has_actuals_for_period(
                db=db,
                goal_sheet_id=goal_sheet_id,
                employee_id=employee_id,
                period_label=period_label,
            )
            
            if has_actuals:
                continue
            
            user = await db[COLLECTION_USERS].find_one({"_id": employee_id})
            if not user:
                continue
            
            manager_id = user.get("manager_id")
            if not manager_id:
                continue
            
            _, is_new = await _get_or_create_escalation(
                db=db,
                goal_sheet_id=goal_sheet_id,
                employee_id=employee_id,
                manager_id=manager_id,
                trigger_type=TriggerType.CHECKIN_DELAY,
                now=now,
                period_label=period_label.value,
            )
            
            if is_new:
                stats["checkin_delay_count"] += 1
    
    # ---------------------------------------------------------------------------
    # 4. Promote Level 1 → Level 2
    # ---------------------------------------------------------------------------
    print("DEBUG: Promoting Level 1 escalations to Level 2...")
    
    # Find all Level 1 ACTIVE escalations > 3 days old
    three_days_ago = now.timestamp() - (3 * 24 * 60 * 60)
    three_days_ago_dt = datetime.fromtimestamp(three_days_ago, tz=timezone.utc)
    print(f"DEBUG: Level 2 promotion cutoff date is {three_days_ago_dt}")
    
    level_1_escalations = db[COLLECTION_ESCALATIONS].find({
        "status": EscalationStatus.ACTIVE,
        "level": 1,
    })
    
    async for escalation in level_1_escalations:
        created_at = escalation.get("created_at")
        if not created_at or make_aware(created_at) >= three_days_ago_dt:
            continue
        print(f"DEBUG: Promoting escalation {escalation.get('escalation_id')} to Level 2")
        await db[COLLECTION_ESCALATIONS].update_one(
            {"_id": escalation["_id"]},
            {
                "$set": {"level": 2},
                "$push": {
                    "audit_log": {
                        "action": "PROMOTED_TO_LEVEL_2",
                        "timestamp": now,
                        "actor_id": "system",
                    }
                },
            },
        )
        stats["level_2_promotions"] += 1
    
    # ---------------------------------------------------------------------------
    # 5. Count total active escalations
    # ---------------------------------------------------------------------------
    print("DEBUG: Counting total active escalations...")
    
    stats["total_active"] = await db[COLLECTION_ESCALATIONS].count_documents({
        "status": EscalationStatus.ACTIVE,
    })
    
    print(f"DEBUG: Escalation engine completed with stats: {stats}")
    return stats
