"""
Goal Sheets router.
Enforces workflow state machine from docs/WORKFLOWS.md.
Permission matrix from docs/ROLE_PERMISSIONS.md.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Annotated, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user, require_roles
from database import (
    COLLECTION_CHECKIN_COMMENTS,
    COLLECTION_CHECKINS,
    COLLECTION_GOAL_SHEETS,
    COLLECTION_GOALS,
    COLLECTION_USERS,
    get_database,
)
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
from services.live_scoring import enrich_sheet_with_live_score, enrich_goal_with_live_score
from services.progress_calculator import calculate_progress

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
    sheets = [_serialize(d) async for d in cursor]
    
    # Enrich each sheet with live computed scores
    enriched_sheets = []
    for sheet in sheets:
        enriched_sheet = await enrich_sheet_with_live_score(sheet, db)
        enriched_sheets.append(enriched_sheet)
    
    return enriched_sheets


# ---------------------------------------------------------------------------
# Export — Planned vs Actual Achievement CSV
# Source: docs/REPORTING_REQUIREMENTS.md §Required Reports
#         docs/ROLE_PERMISSIONS.md §Admin — "Export reports"
# ---------------------------------------------------------------------------

def _iso(dt) -> str:
    """Format a datetime as ISO 8601 (UTC). Returns '' for None/invalid input."""
    if not isinstance(dt, datetime):
        return ""
    # Treat naive timestamps from Motor as UTC.
    if dt.tzinfo is None:
        return dt.isoformat(timespec="seconds") + "Z"
    return dt.isoformat(timespec="seconds")


@router.get("/export/achievement")
async def export_achievement_report(
    current: TokenData = Depends(require_roles(UserRole.ADMIN)),
):
    """
    Admin-only.  Streams a two-section Planned vs Actual CSV:

      1. GOAL DETAIL — one row per goal (goal-level columns only)
      2. SHEET SUMMARY — one row per sheet (sheet-level columns only)

    Joins:
      goal_sheets  (embedded audit_log → submission/approval dates, total_weightage)
      goals        (target, weightage, thrust_area, description)
      checkins     (latest per goal → checkin_quarter, latest_actual_value)
      checkin_comments  (latest matching sheet + quarter → manager_checkin_comment)

    Goals with no check-ins show "n/a" for actuals and "Not Yet" for the
    checkin_quarter column.
    """
    db = get_database()

    # ── 1. Fetch all sheets ──────────────────────────────────────────────────
    sheets = [s async for s in db[COLLECTION_GOAL_SHEETS].find({})]

    # ── 2. Fetch all goals (indexed by sheet_id) ─────────────────────────────
    all_goals = [g async for g in db[COLLECTION_GOALS].find({})]
    goals_by_sheet: dict[str, list] = {}
    for g in all_goals:
        sid = g.get("goal_sheet_id", "")
        goals_by_sheet.setdefault(sid, []).append(g)

    # ── 3. Collect employee user ids for display names ───────────────────────
    user_ids: set[str] = set()
    for s in sheets:
        if s.get("employee_id"):
            user_ids.add(s["employee_id"])

    # ── 4. Latest check-in per goal_id (sort descending by date once) ────────
    checkins_by_goal: dict[str, dict] = {}
    async for ci in db[COLLECTION_CHECKINS].find({}, sort=[("check_in_date", -1)]):
        gid = str(ci.get("goal_id", ""))
        if gid and gid not in checkins_by_goal:
            checkins_by_goal[gid] = ci

    # ── 5. Latest check-in comment per (sheet_id, quarter) ───────────────────
    comments_by_sheet_quarter: dict[tuple[str, str], dict] = {}
    async for c in db[COLLECTION_CHECKIN_COMMENTS].find({}, sort=[("created_at", -1)]):
        key = (c.get("goal_sheet_id", ""), c.get("quarter", ""))
        if key not in comments_by_sheet_quarter:
            comments_by_sheet_quarter[key] = c

    # ── 6. Resolve user names in a single round-trip ─────────────────────────
    user_map: dict[str, dict] = {}
    if user_ids:
        try:
            object_ids = [ObjectId(uid) for uid in user_ids if ObjectId.is_valid(uid)]
        except Exception:
            object_ids = []
        async for u in db[COLLECTION_USERS].find(
            {"_id": {"$in": object_ids}},
            {"_id": 1, "employee_id": 1, "name": 1, "department": 1, "role": 1},
        ):
            user_map[str(u["_id"])] = u

    def latest_audit_ts(audit_log: list, action: str) -> str:
        """ISO timestamp of the most recent audit_log entry for action."""
        matches = [e for e in audit_log if e.get("action") == action]
        if not matches:
            return ""
        latest = max(matches, key=lambda e: e.get("timestamp") or datetime.min)
        return _iso(latest.get("timestamp"))

    # ── 7. Build CSV (goal detail rows, blank line, sheet summary rows) ───────
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")

    goal_detail_header = [
        "employee_id",
        "employee_name",
        "department",
        "period_label",
        "sheet_status",
        "thrust_area",
        "goal_description",
        "planned_target_value",
        "latest_actual_value",
        "achievement_pct",
        "goal_score",
        "weightage",
        "checkin_quarter",
        "manager_checkin_comment",
    ]

    sheet_summary_header = [
        "employee_id",
        "employee_name",
        "sheet_status",
        "period_label",
        "overall_score",
        "total_weightage",
        "submission_date",
        "approval_date",
    ]

    goal_detail_rows: list[list] = []
    sheet_summary_rows: list[list] = []

    for sheet in sheets:
        sid = str(sheet["_id"])
        uid = sheet.get("employee_id", "")
        user = user_map.get(uid, {})

        emp_id = user.get("employee_id", uid)
        emp_name = user.get("name", "")
        department = user.get("department", "")
        period_label = sheet.get("period_label", "")
        sheet_status = sheet.get("status", "")

        # ── Sheet-level audit lookups (used by every goal in the sheet) ─────
        sheet_audit_log: list = sheet.get("audit_log") or []

        # goal_approved_date = timestamp of the 'LOCKED' entry per WORKFLOWS.md
        # §Goal Lifecycle (Approved → Locked).  Fall back to APPROVED entry if
        # the sheet has been unlocked back to APPROVED.
        locked_entry = next(
            (e for e in reversed(sheet_audit_log) if e.get("action") == "LOCKED"),
            None,
        )
        if locked_entry is None:
            locked_entry = next(
                (e for e in reversed(sheet_audit_log) if e.get("action") == "APPROVED"),
                None,
            )
        approval_date = _iso(locked_entry.get("timestamp")) if locked_entry else ""

        submission_date = latest_audit_ts(sheet_audit_log, "SUBMITTED")

        goals = goals_by_sheet.get(sid, [])

        # Pre-compute per-goal scores from latest check-in actuals (VALIDATION_RULES.md)
        scored_goals: list[dict] = []
        total_goal_score = 0.0
        any_scored = False
        for goal in goals:
            gid = str(goal["_id"])
            ci = checkins_by_goal.get(gid)
            raw_actual = ci.get("actual_value") if ci else None
            has_actual = raw_actual is not None and raw_actual != ""

            if has_actual:
                progress = calculate_progress(
                    goal.get("uom_type", ""),
                    goal.get("target_value"),
                    raw_actual,
                    goal.get("weightage", 0),
                )
                achievement_pct = progress.achievement_pct
                goal_score = progress.goal_score
                actual_val = raw_actual
            else:
                achievement_pct = None
                goal_score = None
                actual_val = "n/a"

            if goal_score is not None:
                total_goal_score += goal_score
                any_scored = True

            scored_goals.append({
                "goal": goal,
                "ci": ci,
                "actual_val": actual_val,
                "achievement_pct": achievement_pct,
                "goal_score": goal_score,
            })

        overall_score_str = str(round(total_goal_score, 2)) if any_scored else "n/a"

        sheet_summary_rows.append([
            emp_id,
            emp_name,
            sheet_status,
            period_label,
            overall_score_str,
            sheet.get("total_weightage", ""),
            submission_date,
            approval_date,
        ])

        for row in scored_goals:
            goal = row["goal"]
            ci = row["ci"]
            actual_val = row["actual_val"]
            achievement_pct = row["achievement_pct"]
            goal_score = row["goal_score"]

            checkin_quarter = ci.get("period_label") if ci else "Not Yet"

            # Latest comment for this sheet + this goal's check-in quarter.
            # If there is no check-in yet, fall back to the most-recent
            # comment on the whole sheet (across any quarter) so admins can
            # still see manager guidance.
            comment_doc = None
            if ci:
                comment_doc = comments_by_sheet_quarter.get((sid, ci.get("period_label", "")))
            if comment_doc is None:
                comment_doc = next(
                    (
                        v for k, v in comments_by_sheet_quarter.items()
                        if k[0] == sid
                    ),
                    None,
                )
            manager_comment = (comment_doc.get("comment") if comment_doc else "") or ""

            goal_detail_rows.append([
                emp_id,
                emp_name,
                department,
                period_label,
                sheet_status,
                goal.get("thrust_area", ""),
                goal.get("description", ""),
                goal.get("target_value", ""),
                actual_val,
                str(achievement_pct) if achievement_pct is not None else "n/a",
                str(goal_score) if goal_score is not None else "n/a",
                goal.get("weightage", ""),
                checkin_quarter,
                manager_comment,
            ])

        if not scored_goals:
            goal_detail_rows.append([
                emp_id,
                emp_name,
                department,
                period_label,
                sheet_status,
                "", "", "", "n/a", "n/a", "n/a", "", "", "",
            ])

    writer.writerow(goal_detail_header)
    writer.writerows(goal_detail_rows)
    writer.writerow([])
    writer.writerow(sheet_summary_header)
    writer.writerows(sheet_summary_rows)

    output.seek(0)
    filename = f"achievement_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Unlock — LOCKED → RETURNED  (Admin only)
# Source: docs/ROLE_PERMISSIONS.md §Admin — "Unlock approved goals"
#         docs/REPORTING_REQUIREMENTS.md §Audit Log Rules
#         docs/WORKFLOWS.md §Goal Lifecycle (RETURNED restores employee edit access)
# ---------------------------------------------------------------------------

class UnlockRequest(BaseModel):
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


@router.post("/{sheet_id}/unlock", response_model=GoalSheetPublic)
async def unlock_goal_sheet(
    sheet_id: str,
    body: UnlockRequest,
    current: TokenData = Depends(require_roles(UserRole.ADMIN)),
):
    """
    Admin-only.  Transitions a LOCKED Goal Sheet to RETURNED.

    Workflow (docs/WORKFLOWS.md §Goal Lifecycle): LOCKED → RETURNED
    RETURNED restores full employee edit + resubmission capability
    (RETURNED → SUBMITTED → APPROVED → LOCKED is the normal path back).

    A mandatory `reason` is required and is persisted in:
      - embedded `audit_log` as action='UNLOCKED' (docs/REPORTING_REQUIREMENTS.md
        §Audit Log Rules — who, previous value, new value, why, timestamp)
      - `review_comment` field — surfaces the reason in the Employee dashboard
        RETURNED banner so the employee immediately sees why the sheet was reopened
      - `reviewed_by` field — identifies the Admin who performed the action

    Permission: Admin-only (docs/ROLE_PERMISSIONS.md §Admin — "Unlock approved goals").
    """
    db = get_database()
    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal Sheet not found")

    if GoalSheetStatus(doc["status"]) != GoalSheetStatus.LOCKED:
        raise HTTPException(
            status_code=422,
            detail="Only LOCKED Goal Sheets can be unlocked.",
        )

    now = datetime.utcnow()

    # Audit entry records the UNLOCKED action with full governance metadata
    audit_entry = AuditLogEntry(
        action="UNLOCKED",
        actor_id=current.user_id,
        actor_role=current.role.value,
        timestamp=now,
        comment=body.reason,
    ).model_dump()

    await db[COLLECTION_GOAL_SHEETS].update_one(
        {"_id": ObjectId(sheet_id)},
        {
            "$set": {
                # LOCKED → RETURNED restores employee edit + resubmission capability
                "status": GoalSheetStatus.RETURNED,
                "review_comment": body.reason,
                "reviewed_by": current.user_id,
                "updated_at": now,
            },
            "$push": {"audit_log": audit_entry},
        },
    )

    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
    return _serialize(doc)


# ---------------------------------------------------------------------------
# Unlock History — Admin governance feed
# Source: docs/REPORTING_REQUIREMENTS.md §Audit Log Rules
#         docs/ROLE_PERMISSIONS.md §Admin — "View audit logs"
# ---------------------------------------------------------------------------

@router.get("/unlock-history", response_model=list)
async def get_unlock_history(
    current: TokenData = Depends(require_roles(UserRole.ADMIN)),
):
    """
    Admin-only.  Returns all goal sheets that have at least one UNLOCKED
    audit-log entry, ordered by most-recent unlock timestamp descending.

    Each item includes:
      - sheet id, employee info, period label, current status
      - the most-recent UNLOCKED audit entry (actor, reason, timestamp)

    Used by the Admin Governance / Unlock History feed on the dashboard.
    """
    from bson import ObjectId as BsonObjectId

    db = get_database()

    # Sheets with any UNLOCKED entry
    sheets = [
        s async for s in db[COLLECTION_GOAL_SHEETS].find(
            {"audit_log.action": "UNLOCKED"}
        )
    ]

    # Collect unique user IDs we need to resolve
    user_ids: set[str] = set()
    for s in sheets:
        if s.get("employee_id"):
            user_ids.add(s["employee_id"])
        for entry in s.get("audit_log") or []:
            if entry.get("action") == "UNLOCKED" and entry.get("actor_id"):
                user_ids.add(entry["actor_id"])

    # Batch-resolve names
    user_map: dict[str, dict] = {}
    if user_ids:
        valid_oids = [BsonObjectId(uid) for uid in user_ids if BsonObjectId.is_valid(uid)]
        async for u in db[COLLECTION_USERS].find(
            {"_id": {"$in": valid_oids}},
            {"_id": 1, "name": 1, "employee_id": 1, "department": 1},
        ):
            user_map[str(u["_id"])] = u

    results = []
    for s in sheets:
        # Find the most recent UNLOCKED entry
        unlocked_entries = [
            e for e in (s.get("audit_log") or []) if e.get("action") == "UNLOCKED"
        ]
        if not unlocked_entries:
            continue
        latest_unlock = max(
            unlocked_entries,
            key=lambda e: e.get("timestamp") or datetime.min,
        )

        emp = user_map.get(s.get("employee_id", ""), {})
        actor = user_map.get(latest_unlock.get("actor_id", ""), {})

        results.append({
            "sheet_id": str(s["_id"]),
            "employee_id": s.get("employee_id", ""),
            "employee_name": emp.get("name", s.get("employee_id", "")),
            "department": emp.get("department", ""),
            "period_label": s.get("period_label", ""),
            "current_status": s.get("status", ""),
            "unlock_reason": latest_unlock.get("comment", ""),
            "unlocked_by_id": latest_unlock.get("actor_id", ""),
            "unlocked_by_name": actor.get("name", latest_unlock.get("actor_id", "")),
            "unlocked_at": latest_unlock.get("timestamp"),
            "total_unlocks": len(unlocked_entries),
        })

    # Sort by most recent unlock descending
    results.sort(
        key=lambda r: r["unlocked_at"] or datetime.min,
        reverse=True,
    )
    return results


# ---------------------------------------------------------------------------
# Read (single sheet — MUST be declared after all fixed /export and /unlock paths)
# ---------------------------------------------------------------------------

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

    # Enrich with live computed scores
    doc = await enrich_sheet_with_live_score(_serialize(doc), db)
    return doc


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
