"""
Centralized helpers for immutable quarterly score snapshots on goal sheets.

Snapshots live in MongoDB under each goal_sheets document as optional `quarter_snapshots`.
This module does not hook into check-in flows, dashboards, or HTTP routes.

Writes are append-only per (sheet, quarter_label). Existing snapshots are never modified.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Optional, Union

from bson import ObjectId
from pydantic import ValidationError

from database import COLLECTION_GOAL_SHEETS
from models.quarter_snapshot import QuarterSnapshot, QuarterSnapshotGoalFrozen

SnapshotInput = Union[QuarterSnapshot, Mapping[str, Any]]


class QuarterSnapshotConflictError(Exception):
    """Raised when a snapshot already exists for the same goal sheet and quarter."""


class QuarterSnapshotNotFoundError(Exception):
    """Raised when addressing a non-existent goal sheet during write."""


def _normalize_snapshot(snapshot: SnapshotInput) -> QuarterSnapshot:
    if isinstance(snapshot, QuarterSnapshot):
        return snapshot
    return QuarterSnapshot.model_validate(dict(snapshot))


def _snapshot_to_storable(snapshot: QuarterSnapshot) -> dict[str, Any]:
    data = snapshot.model_dump(mode="python")
    data["locked"] = True
    return data


async def read_quarter_snapshot(
    db,
    sheet_id: str,
    quarter_label: str,
) -> Optional[QuarterSnapshot]:
    """
    Load and validate the snapshot for `quarter_label` on the given sheet.

    Returns None if the sheet id is invalid, the sheet is missing, or there is no snapshot.
    """
    if not ObjectId.is_valid(sheet_id):
        return None

    doc = await db[COLLECTION_GOAL_SHEETS].find_one(
        {"_id": ObjectId(sheet_id)},
        {"quarter_snapshots": 1},
    )
    if not doc:
        return None

    for raw in doc.get("quarter_snapshots") or []:
        if not isinstance(raw, dict):
            continue
        if raw.get("quarter_label") != quarter_label:
            continue
        try:
            return QuarterSnapshot.model_validate(raw)
        except ValidationError:
            return None
    return None


async def quarter_snapshot_exists(db, sheet_id: str, quarter_label: str) -> bool:
    """True if a goal sheet document contains a snapshot for `quarter_label`."""
    if not ObjectId.is_valid(sheet_id):
        return False

    count = await db[COLLECTION_GOAL_SHEETS].count_documents(
        {
            "_id": ObjectId(sheet_id),
            "quarter_snapshots": {"$elemMatch": {"quarter_label": quarter_label}},
        },
        limit=1,
    )
    return count > 0


async def write_quarter_snapshot(
    db,
    sheet_id: str,
    snapshot: SnapshotInput,
) -> None:
    """
    Atomically append a snapshot if none exists yet for this quarter.

    Always persists `locked=True`. Does not update or replace existing entries.
    """
    model = _normalize_snapshot(snapshot)
    payload = _snapshot_to_storable(model)

    if not ObjectId.is_valid(sheet_id):
        raise QuarterSnapshotNotFoundError("Invalid goal sheet id")

    oid = ObjectId(sheet_id)
    quarter_label = payload["quarter_label"]

    filter_doc = {
        "_id": oid,
        "$nor": [
            {"quarter_snapshots": {"$elemMatch": {"quarter_label": quarter_label}}},
        ],
    }

    result = await db[COLLECTION_GOAL_SHEETS].update_one(
        filter_doc,
        {"$push": {"quarter_snapshots": payload}},
    )

    if result.modified_count > 0:
        return

    doc = await db[COLLECTION_GOAL_SHEETS].find_one({"_id": oid}, {"quarter_snapshots": 1})
    if not doc:
        raise QuarterSnapshotNotFoundError("Goal Sheet not found")

    has_quarter = any(
        isinstance(s, dict) and s.get("quarter_label") == quarter_label
        for s in (doc.get("quarter_snapshots") or [])
    )
    if has_quarter:
        raise QuarterSnapshotConflictError(
            f"Quarter snapshot for {quarter_label!r} already exists for this sheet"
        )

    raise RuntimeError("Failed to append quarter snapshot")


async def freeze_snapshot_for_quarter(
    db,
    sheet_id: str,
    quarter_label: str,
    frozen_by: str,
) -> QuarterSnapshot:
    """
    Centralized immutable quarter snapshot freezing service.
    
    FREEZE CONDITIONS (caller's responsibility to verify):
    - Quarter review window has closed, OR
    - Manager finalized/reviewed the quarter, OR
    - Explicit admin/manual freeze action
    
    DATA SOURCE:
    - Uses ONLY existing live scoring authority (calculate_progress formulas)
    - Sources values from live computation, NOT persisted scores
    
    IMMUTABILITY:
    - Creates exactly ONE snapshot per (sheet, quarter)
    - Re-freeze attempts are rejected with QuarterSnapshotConflictError
    - Frozen snapshots become immutable historical truth
    
    VALIDATION:
    - If no valid check-ins exist, raises ValueError (no snapshot created)
    - Prevents duplicate snapshot creation
    
    Args:
        db: Database connection
        sheet_id: Goal sheet ID to freeze
        quarter_label: Quarter to freeze (e.g. "Q1", "Q2", "Q3", "Q4")
        frozen_by: User ID of who initiated the freeze
        
    Returns:
        QuarterSnapshot: The created immutable snapshot
        
    Raises:
        ValueError: If sheet not found, invalid inputs, or no check-ins exist
        QuarterSnapshotConflictError: If snapshot already exists for this quarter
        QuarterSnapshotNotFoundError: If sheet ID is invalid
    """
    # Validate inputs
    if not sheet_id or not ObjectId.is_valid(sheet_id):
        raise ValueError(f"Invalid sheet_id: {sheet_id}")
    
    if not quarter_label or not isinstance(quarter_label, str):
        raise ValueError(f"Invalid quarter_label: {quarter_label}")
    
    if not frozen_by or not isinstance(frozen_by, str):
        raise ValueError(f"Invalid frozen_by: {frozen_by}")
    
    # Verify sheet exists
    sheet_doc = await db[COLLECTION_GOAL_SHEETS].find_one(
        {"_id": ObjectId(sheet_id)},
        {"_id": 1}
    )
    if not sheet_doc:
        raise ValueError(f"Goal sheet not found: {sheet_id}")
    
    # Check if snapshot already exists (prevent duplicates)
    if await quarter_snapshot_exists(db, sheet_id, quarter_label):
        raise QuarterSnapshotConflictError(
            f"Quarter snapshot for {quarter_label!r} already exists for sheet {sheet_id}"
        )
    
    # Import dependencies
    from database import COLLECTION_CHECKINS, COLLECTION_GOALS
    from services.progress_calculator import calculate_progress
    
    # Count check-ins for this specific quarter
    checkin_count = await db[COLLECTION_CHECKINS].count_documents({
        "goal_sheet_id": sheet_id,
        "period_label": quarter_label,
    })
    
    # Validate: only freeze if check-ins exist for this quarter
    if checkin_count == 0:
        raise ValueError(
            f"Cannot freeze snapshot for {quarter_label}: no check-ins exist for sheet {sheet_id}"
        )
    
    # Fetch all goals for this sheet
    goals = []
    async for goal in db[COLLECTION_GOALS].find({"goal_sheet_id": sheet_id}):
        goals.append(goal)
    
    if not goals:
        raise ValueError(f"No goals found for sheet {sheet_id}")
    
    # Fetch all check-ins for this specific quarter
    checkins_by_goal = {}
    async for checkin in db[COLLECTION_CHECKINS].find({
        "goal_sheet_id": sheet_id,
        "period_label": quarter_label,
    }):
        goal_id = str(checkin.get("goal_id", ""))
        if goal_id:
            if goal_id not in checkins_by_goal:
                checkins_by_goal[goal_id] = []
            checkins_by_goal[goal_id].append(checkin)
    
    # Compute scores for each goal using existing scoring formulas
    frozen_goals = []
    total_score = 0.0
    
    for goal in goals:
        goal_id = str(goal["_id"])
        goal_checkins = checkins_by_goal.get(goal_id, [])
        
        if not goal_checkins:
            continue
        
        # Get latest check-in for this quarter
        latest_checkin = max(goal_checkins, key=lambda x: x.get("check_in_date", datetime.min))
        
        # Use existing progress calculation (live scoring authority)
        progress = calculate_progress(
            uom_type=goal.get("uom_type"),
            target_value=goal.get("target_value"),
            actual_value=latest_checkin.get("actual_value"),
            weightage=float(goal.get("weightage", 0)),
        )
        
        if progress.goal_score is not None:
            frozen_goals.append(
                QuarterSnapshotGoalFrozen(
                    goal_id=goal_id,
                    goal_score=progress.goal_score,
                    achievement_pct=progress.achievement_pct or 0.0,
                    actual_value=latest_checkin.get("actual_value"),
                )
            )
            total_score += progress.goal_score
    
    # Create immutable snapshot with computed values
    snapshot = QuarterSnapshot(
        quarter_label=quarter_label,
        overall_score=round(total_score, 2),
        goals=frozen_goals,
        frozen_at=datetime.now(timezone.utc),
        frozen_by=frozen_by,
        source_check_in_count=checkin_count,
        locked=True,
    )
    
    # Persist snapshot (write_quarter_snapshot enforces no-overwrite)
    await write_quarter_snapshot(db, sheet_id, snapshot)
    
    return snapshot
