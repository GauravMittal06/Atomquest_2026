"""
Centralized Quarter Visibility Resolution Service

This module provides the canonical source of truth for determining quarter visibility,
combining window state and snapshot existence to control what quarters are shown/hidden
and whether to use live scoring vs. frozen snapshots.

CRITICAL RULES (docs/CHECKIN_RULES.md):

    FUTURE QUARTER:
        - no snapshot
        - unopened review window
        → HIDDEN

    ACTIVE QUARTER:
        - active review window
        → VISIBLE (use LIVE scoring)

    CLOSED/FROZEN QUARTER:
        - snapshot exists
        → VISIBLE (use SNAPSHOT values)
        → ignore current mock date

Window gating controls:
    - editability
    - active live scoring

Snapshot existence controls:
    - historical visibility
    - analytics
    - reporting
    - charts
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

from services.checkin_window import (
    QuarterId,
    get_current_cycle_status,
)


class QuarterState(str, Enum):
    """Canonical quarter state for visibility and scoring resolution."""
    
    FUTURE = "FUTURE"          # Not yet reached, window unopened → HIDDEN
    ACTIVE = "ACTIVE"          # Current window open → VISIBLE with LIVE scoring
    CLOSED_NO_SNAPSHOT = "CLOSED_NO_SNAPSHOT"  # Window closed, no snapshot → HIDDEN
    FROZEN = "FROZEN"          # Snapshot exists → VISIBLE with SNAPSHOT


@dataclass(frozen=True)
class QuarterVisibility:
    """
    Resolved visibility state for a single quarter.
    
    This is the canonical result of quarter visibility resolution.
    """
    
    quarter_label: str
    state: QuarterState
    is_visible: bool
    use_live_scoring: bool
    use_snapshot: bool
    window_is_open: bool
    snapshot_exists: bool


@dataclass(frozen=True)
class QuarterVisibilitySet:
    """
    Complete visibility resolution for all quarters.
    
    This is returned by resolve_quarter_visibility() and provides all
    information needed for dashboards, charts, and scoring logic.
    """
    
    quarters: List[QuarterVisibility]
    active_quarter: Optional[str]
    visible_quarter_labels: List[str]
    frozen_quarter_labels: List[str]
    live_quarter_labels: List[str]


# Quarter order for determining "future" vs "past"
QUARTER_ORDER = [QuarterId.Q1, QuarterId.Q2, QuarterId.Q3, QuarterId.Q4]


def resolve_quarter_state(
    quarter_label: str,
    snapshot_exists: bool,
    current_quarter: Optional[QuarterId] = None,
) -> QuarterState:
    """
    Determine the canonical state for a single quarter.
    
    Args:
        quarter_label: Quarter to resolve (e.g., "Q1", "Q2", "Q3", "Q4")
        snapshot_exists: Whether a frozen snapshot exists for this quarter
        current_quarter: Active quarter from cycle status (None if between windows)
    
    Returns:
        QuarterState: FUTURE, ACTIVE, CLOSED_NO_SNAPSHOT, or FROZEN
    
    Logic:
        1. If snapshot exists → FROZEN (always visible, use snapshot)
        2. If current quarter matches → ACTIVE (visible, use live scoring)
        3. If quarter is in the future → FUTURE (hidden)
        4. If quarter is in the past but no snapshot → CLOSED_NO_SNAPSHOT (hidden)
    """
    # FROZEN: Snapshot exists → always visible, use snapshot values
    if snapshot_exists:
        return QuarterState.FROZEN
    
    # ACTIVE: Current quarter window is open → visible, use live scoring
    if current_quarter and current_quarter.value == quarter_label:
        return QuarterState.ACTIVE
    
    # Determine if this quarter is future, past, or unreachable
    try:
        quarter_enum = QuarterId(quarter_label)
    except ValueError:
        # Invalid quarter label → treat as hidden
        return QuarterState.CLOSED_NO_SNAPSHOT
    
    # During goal setting, no quarters are "active" yet
    if current_quarter == QuarterId.GOAL_SETTING:
        # All quarters are future during goal setting
        return QuarterState.FUTURE
    
    # Between windows (current_quarter is None)
    if current_quarter is None:
        # Assume we're past all quarters, so this is a past quarter without snapshot
        return QuarterState.CLOSED_NO_SNAPSHOT
    
    # Determine position relative to current quarter
    try:
        current_index = QUARTER_ORDER.index(current_quarter)
        quarter_index = QUARTER_ORDER.index(quarter_enum)
        
        if quarter_index > current_index:
            # Future quarter → hidden
            return QuarterState.FUTURE
        else:
            # Past quarter without snapshot → hidden
            return QuarterState.CLOSED_NO_SNAPSHOT
    except ValueError:
        # Can't determine order → treat as hidden
        return QuarterState.CLOSED_NO_SNAPSHOT


def resolve_quarter_visibility(
    quarter_label: str,
    snapshot_exists: bool,
    current_quarter: Optional[QuarterId] = None,
) -> QuarterVisibility:
    """
    Resolve complete visibility information for a single quarter.
    
    This is the primary function for determining how to handle a specific quarter.
    
    Args:
        quarter_label: Quarter to resolve (e.g., "Q1", "Q2", "Q3", "Q4")
        snapshot_exists: Whether a frozen snapshot exists for this quarter
        current_quarter: Active quarter from cycle status (None if between windows)
    
    Returns:
        QuarterVisibility: Complete visibility resolution with all flags
    
    Example:
        >>> visibility = resolve_quarter_visibility("Q1", snapshot_exists=True)
        >>> if visibility.use_snapshot:
        >>>     score = get_snapshot_score(sheet_id, "Q1")
        >>> elif visibility.use_live_scoring:
        >>>     score = compute_live_score(sheet_id, "Q1")
    """
    state = resolve_quarter_state(quarter_label, snapshot_exists, current_quarter)
    
    # Derive visibility and scoring flags from state
    is_visible = state in (QuarterState.ACTIVE, QuarterState.FROZEN)
    use_live_scoring = state == QuarterState.ACTIVE
    use_snapshot = state == QuarterState.FROZEN
    window_is_open = state == QuarterState.ACTIVE
    
    return QuarterVisibility(
        quarter_label=quarter_label,
        state=state,
        is_visible=is_visible,
        use_live_scoring=use_live_scoring,
        use_snapshot=use_snapshot,
        window_is_open=window_is_open,
        snapshot_exists=snapshot_exists,
    )


async def resolve_all_quarters_visibility(
    db,
    sheet_id: str,
) -> QuarterVisibilitySet:
    """
    Resolve visibility for all quarters for a specific goal sheet.
    
    This is the top-level function for dashboards and reports to get complete
    quarter visibility information.
    
    Args:
        db: Database connection
        sheet_id: Goal sheet ID to resolve quarters for
    
    Returns:
        QuarterVisibilitySet: Complete visibility resolution for all quarters
    
    Example:
        >>> visibility_set = await resolve_all_quarters_visibility(db, sheet_id)
        >>> for quarter in visibility_set.quarters:
        >>>     if quarter.is_visible:
        >>>         if quarter.use_snapshot:
        >>>             # Display frozen snapshot
        >>>         elif quarter.use_live_scoring:
        >>>             # Display live score
    """
    from services.quarter_snapshots import quarter_snapshot_exists
    
    # Get current cycle status
    cycle_status = get_current_cycle_status()
    current_quarter = cycle_status.active_quarter
    
    # Resolve visibility for all quarters
    quarters: List[QuarterVisibility] = []
    visible_quarter_labels: List[str] = []
    frozen_quarter_labels: List[str] = []
    live_quarter_labels: List[str] = []
    
    for quarter_label in ["Q1", "Q2", "Q3", "Q4"]:
        # Check if snapshot exists for this quarter
        snapshot_exists = await quarter_snapshot_exists(db, sheet_id, quarter_label)
        
        # Resolve visibility
        visibility = resolve_quarter_visibility(
            quarter_label,
            snapshot_exists,
            current_quarter,
        )
        
        quarters.append(visibility)
        
        if visibility.is_visible:
            visible_quarter_labels.append(quarter_label)
            
            if visibility.use_snapshot:
                frozen_quarter_labels.append(quarter_label)
            elif visibility.use_live_scoring:
                live_quarter_labels.append(quarter_label)
    
    return QuarterVisibilitySet(
        quarters=quarters,
        active_quarter=current_quarter.value if current_quarter else None,
        visible_quarter_labels=visible_quarter_labels,
        frozen_quarter_labels=frozen_quarter_labels,
        live_quarter_labels=live_quarter_labels,
    )


def get_visible_quarters_simple(current_quarter: Optional[QuarterId] = None) -> List[str]:
    """
    Simple visibility resolver WITHOUT snapshot checking (for backward compatibility).
    
    WARNING: This function does NOT check snapshot existence. It only considers
    window state. Use resolve_all_quarters_visibility() for complete visibility
    resolution that includes frozen snapshots.
    
    This function is provided for compatibility with existing code that doesn't
    have access to database/sheet_id. New code should use the full resolver.
    
    Returns:
        List of quarter labels that should be visible based on window state only
        (does NOT include frozen historical quarters)
    """
    if current_quarter is None:
        cycle_status = get_current_cycle_status()
        current_quarter = cycle_status.active_quarter
    
    visible_quarters = []
    
    # During goal setting, no quarterly scores are visible yet
    if current_quarter == QuarterId.GOAL_SETTING:
        return []
    
    # Between windows, show all past quarters (but caller must check snapshots!)
    if current_quarter is None:
        return []
    
    # Show only quarters whose windows have closed (before current quarter)
    for quarter in QUARTER_ORDER:
        if quarter == current_quarter:
            # Active quarter - don't include (window is open)
            break
        visible_quarters.append(quarter.value)
    
    return visible_quarters
