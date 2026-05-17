"""
Shared KPIs router.

Implements the 'Shared Goals' feature (docs/SHARED_GOALS.md):
  - Admin or Manager pushes a departmental KPI to multiple employees at once
  - Each recipient gets a Goal document referencing the master SharedKpi
  - Employees may only edit the Weightage field on their copy
  - Achievement syncs automatically from the designated primary owner
    (handled in routers/checkins.py _update_goal_achievement)

Permission (docs/ROLE_PERMISSIONS.md):
  - Admin/Manager can push shared KPIs
  - MANAGER callers: recipients must report to them
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from auth import require_roles
from database import (
    COLLECTION_GOAL_SHEETS,
    COLLECTION_GOALS,
    COLLECTION_SHARED_KPIS,
    COLLECTION_USERS,
    get_database,
)
from models.goal import GoalPublic, SharedGoalRef, ThrustArea, UoMType
from models.goal_sheet import AuditLogEntry, GoalSheetCreate, GoalSheetStatus
from models.shared_kpi import (
    PushRecipientResult,
    PushStatus,
    SharedKpiPublic,
    SharedKpiPush,
    SharedKpiPushResponse,
)
from models.user import TokenData, UserRole

router = APIRouter(prefix="/api/shared-kpis", tags=["Shared KPIs"])

MAX_GOALS_PER_SHEET = 8


def _serialize(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
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
    await db[COLLECTION_GOAL_SHEETS].update_one(
        {"_id": ObjectId(sheet_id)},
        {"$set": {"goal_count": 0, "total_weightage": 0.0, "updated_at": datetime.utcnow()}},
    )


async def _find_or_create_draft_sheet(
    employee_id: str,
    period_id: str,
    period_label: str,
    creator_id: str,
    db,
) -> tuple[str, bool]:
    """
    Find the most recent DRAFT or RETURNED sheet for the employee+period,
    or create a new DRAFT sheet.

    Returns (sheet_id, was_created).
    """
    editable_doc = await db[COLLECTION_GOAL_SHEETS].find_one(
        {
            "employee_id": employee_id,
            "period_id": period_id,
            "status": {"$in": [GoalSheetStatus.DRAFT, GoalSheetStatus.RETURNED]},
        },
        sort=[("updated_at", -1)],
    )
    if editable_doc:
        return str(editable_doc["_id"]), False

    # No editable sheet — create a fresh DRAFT
    now = datetime.utcnow()
    sheet_doc: dict = {
        "period_id": period_id,
        "period_label": period_label,
        "employee_id": employee_id,
        "status": GoalSheetStatus.DRAFT,
        "goal_count": 0,
        "total_weightage": 0.0,
        "overall_score": None,
        "reviewed_by": None,
        "review_comment": None,
        "audit_log": [
            AuditLogEntry(
                action=GoalSheetStatus.DRAFT,
                actor_id=creator_id,
                actor_role=UserRole.ADMIN,
            ).model_dump()
        ],
        "created_at": now,
        "updated_at": now,
    }
    result = await db[COLLECTION_GOAL_SHEETS].insert_one(sheet_doc)
    return str(result.inserted_id), True


# ---------------------------------------------------------------------------
# POST /api/shared-kpis/push
# ---------------------------------------------------------------------------

@router.post("/push", response_model=SharedKpiPushResponse, status_code=status.HTTP_201_CREATED)
async def push_shared_kpi(
    body: SharedKpiPush,
    current: TokenData = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
):
    """
    Push a departmental KPI to multiple employees simultaneously.

    For each recipient:
      1. Find their DRAFT/RETURNED sheet for the period, or create one
      2. Guard: max 8 goals per sheet
      3. Guard: no duplicate (description + thrust_area) on that sheet
      4. Insert a Goal document with shared_goal_ref set
      5. Recalculate sheet totals

    Employees may only edit the weightage on their copy.
    Achievement data syncs from the primary owner's check-ins (SHARED_GOALS.md).
    """
    db = get_database()

    # ── Validate all recipients exist and are EMPLOYEE role ──────────────────
    recipient_docs: dict[str, dict] = {}
    for emp_id in body.recipient_ids:
        emp = await db[COLLECTION_USERS].find_one({"_id": ObjectId(emp_id)})
        if not emp:
            raise HTTPException(
                status_code=404,
                detail=f"Recipient user '{emp_id}' not found.",
            )
        if emp.get("role") != UserRole.EMPLOYEE:
            raise HTTPException(
                status_code=422,
                detail=f"User '{emp.get('name', emp_id)}' is not an EMPLOYEE.",
            )
        # Manager access: every recipient must report to this manager
        if current.role == UserRole.MANAGER and emp.get("manager_id") != current.user_id:
            raise HTTPException(
                status_code=403,
                detail=f"Employee '{emp.get('name', emp_id)}' does not report to you.",
            )
        recipient_docs[emp_id] = emp

    # ── Validate primary owner is among recipients ────────────────────────────
    # (model_validator in SharedKpiPush already checks this, but guard again)
    if body.primary_owner_id not in recipient_docs:
        raise HTTPException(
            status_code=422,
            detail="primary_owner_id must be one of the recipient_ids.",
        )

    # ── Validate target_value per uom_type ────────────────────────────────────
    _validate_target(body.target_value, body.uom_type)

    link_id = str(uuid.uuid4())
    now = datetime.utcnow()
    push_results: list[PushRecipientResult] = []

    # ── Push to each recipient ────────────────────────────────────────────────
    for emp_id in body.recipient_ids:
        emp = recipient_docs[emp_id]
        emp_name = emp.get("name", emp_id)

        try:
            # 1. Guard: employee must not have a SUBMITTED/APPROVED/LOCKED sheet
            #    for this period (can't add goals to frozen sheets)
            blocked = await db[COLLECTION_GOAL_SHEETS].find_one({
                "employee_id": emp_id,
                "period_id": body.period_id,
                "status": {"$in": [
                    GoalSheetStatus.SUBMITTED,
                    GoalSheetStatus.APPROVED,
                    GoalSheetStatus.LOCKED,
                ]},
            })
            if blocked:
                push_results.append(PushRecipientResult(
                    employee_id=emp_id,
                    employee_name=emp_name,
                    status=PushStatus.SKIPPED,
                    message=(
                        f"Sheet is currently '{blocked['status']}' — "
                        "goals can only be added to DRAFT or RETURNED sheets."
                    ),
                ))
                continue

            # 2. Find or create an editable sheet
            sheet_id, was_created = await _find_or_create_draft_sheet(
                emp_id, body.period_id, body.period_label, current.user_id, db
            )

            # 3. Guard: max 8 goals
            sheet_doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": ObjectId(sheet_id)})
            if sheet_doc and sheet_doc.get("goal_count", 0) >= MAX_GOALS_PER_SHEET:
                push_results.append(PushRecipientResult(
                    employee_id=emp_id,
                    employee_name=emp_name,
                    status=PushStatus.SKIPPED,
                    message="Sheet already has the maximum 8 goals.",
                ))
                continue

            # 4. Guard: no duplicate (description + thrust_area) on this sheet
            dup = await db[COLLECTION_GOALS].find_one({
                "goal_sheet_id": sheet_id,
                "thrust_area": body.thrust_area,
                "description": body.description,
            })
            if dup:
                push_results.append(PushRecipientResult(
                    employee_id=emp_id,
                    employee_name=emp_name,
                    status=PushStatus.SKIPPED,
                    message="A goal with the same Thrust Area and Description already exists on this sheet.",
                ))
                continue

            # 5. Insert the shared goal
            goal_doc: dict = {
                "goal_sheet_id": sheet_id,
                "owner_id": emp_id,
                "thrust_area": body.thrust_area,
                "description": body.description,
                "uom_type": body.uom_type,
                "unit_of_measure": body.unit_of_measure,
                "target_value": body.target_value,
                "weightage": body.default_weightage,
                "shared_goal_ref": {
                    "is_shared": True,
                    "link_id": link_id,
                    "originator_id": current.user_id,
                    "primary_owner_id": body.primary_owner_id,
                    "partner_id": None,
                    "request_status": "ACCEPTED",
                },
                "latest_actual_value": None,
                "achievement_pct": None,
                "goal_score": None,
                "created_at": now,
                "updated_at": now,
            }
            result = await db[COLLECTION_GOALS].insert_one(goal_doc)
            goal_id = str(result.inserted_id)

            await _recalculate_sheet_totals(sheet_id, db)

            push_results.append(PushRecipientResult(
                employee_id=emp_id,
                employee_name=emp_name,
                status=PushStatus.SUCCESS,
                message="Shared KPI added successfully." + (" (new DRAFT sheet created)" if was_created else ""),
                goal_id=goal_id,
                goal_sheet_id=sheet_id,
            ))

        except Exception as exc:
            push_results.append(PushRecipientResult(
                employee_id=emp_id,
                employee_name=emp_name,
                status=PushStatus.ERROR,
                message=f"Unexpected error: {exc}",
            ))

    # ── Persist master SharedKpi document ────────────────────────────────────
    skpi_doc: dict = {
        "link_id": link_id,
        "created_by": current.user_id,
        "creator_role": current.role.value,
        "period_id": body.period_id,
        "period_label": body.period_label,
        "thrust_area": body.thrust_area,
        "description": body.description,
        "uom_type": body.uom_type,
        "unit_of_measure": body.unit_of_measure,
        "target_value": body.target_value,
        "default_weightage": body.default_weightage,
        "primary_owner_id": body.primary_owner_id,
        "recipient_ids": body.recipient_ids,
        "push_results": [r.model_dump() for r in push_results],
        "created_at": now,
    }
    kpi_result = await db[COLLECTION_SHARED_KPIS].insert_one(skpi_doc)

    success_count = sum(1 for r in push_results if r.status == PushStatus.SUCCESS)
    skip_count = sum(1 for r in push_results if r.status == PushStatus.SKIPPED)
    error_count = sum(1 for r in push_results if r.status == PushStatus.ERROR)

    return SharedKpiPushResponse(
        link_id=link_id,
        shared_kpi_id=str(kpi_result.inserted_id),
        description=body.description,
        push_results=push_results,
        success_count=success_count,
        skip_count=skip_count,
        error_count=error_count,
    )


# ---------------------------------------------------------------------------
# GET /api/shared-kpis/
# ---------------------------------------------------------------------------

@router.get("/", response_model=list[SharedKpiPublic])
async def list_shared_kpis(
    period_id: str | None = Query(None),
    current: TokenData = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
):
    """List all shared KPIs created by this manager (or all, for Admin)."""
    db = get_database()
    query: dict = {}
    if current.role == UserRole.MANAGER:
        query["created_by"] = current.user_id
    if period_id:
        query["period_id"] = period_id
    cursor = db[COLLECTION_SHARED_KPIS].find(query).sort("created_at", -1)
    return [_serialize(d) async for d in cursor]


# ---------------------------------------------------------------------------
# GET /api/shared-kpis/{kpi_id}
# ---------------------------------------------------------------------------

@router.get("/{kpi_id}", response_model=SharedKpiPublic)
async def get_shared_kpi(
    kpi_id: str,
    current: TokenData = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER)),
):
    db = get_database()
    doc = await db[COLLECTION_SHARED_KPIS].find_one({"_id": ObjectId(kpi_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Shared KPI not found")
    if current.role == UserRole.MANAGER and doc.get("created_by") != current.user_id:
        raise HTTPException(status_code=403, detail="Access denied.")
    return _serialize(doc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_target(target_value: Any, uom_type: UoMType) -> None:
    """Raise HTTPException if target_value is invalid for the given uom_type."""
    if uom_type == UoMType.NUMERIC:
        try:
            val = float(target_value)
        except (TypeError, ValueError):
            raise HTTPException(422, "target_value must be a positive number for Numeric goals.")
        if val <= 0:
            raise HTTPException(422, "target_value must be > 0 for Numeric goals.")
    elif uom_type == UoMType.TIMELINE:
        val = str(target_value).strip()
        if not val or len(val) > 500:
            raise HTTPException(422, "target_value must be a non-empty string (max 500 chars) for Timeline goals.")
    else:  # ZERO
        if str(target_value).strip() not in ("Yes", "No"):
            raise HTTPException(422, 'target_value must be "Yes" or "No" for Zero goals.')
