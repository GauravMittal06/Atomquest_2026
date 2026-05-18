"""
Live Scoring Service for AtomQuest Goal Tracking Portal

This service provides window-aware live score computation functionality for Phase 3 and Phase 4.
All scoring-related endpoints must use these functions instead of reading persisted score values
from the database.

Key features:
- Computes scores live from goals and checkins collections
- Window-aware gating: hides scores during active review windows
- Future quarter protection: never shows future quarter scores
- Proper null handling when no check-ins exist
- Maintains existing API contracts

IMPORTANT: For complete quarter visibility resolution (including snapshot-based historical
quarters), use services.quarter_visibility.resolve_all_quarters_visibility() instead of
get_visible_quarters(). This module's get_visible_quarters() only considers window state
and does NOT include frozen historical quarters.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from database import COLLECTION_CHECKINS, COLLECTION_GOALS
from services.checkin_window import get_current_cycle_status, QuarterId
from services.progress_calculator import calculate_progress

# Quarter order for determining "future" quarters
QUARTER_ORDER = [QuarterId.Q1, QuarterId.Q2, QuarterId.Q3, QuarterId.Q4]


@dataclass
class LiveGoalScore:
    """Live computed score for a single goal"""
    goal_id: str
    achievement_pct: Optional[float]
    goal_score: Optional[float] 
    latest_actual_value: Any
    check_in_exists: bool
    visible_quarters: List[str]  # Quarters that are visible (window closed)


@dataclass
class LiveSheetScore:
    """Live computed overall score for a goal sheet"""
    sheet_id: str
    overall_score: Optional[float]
    goal_scores: List[LiveGoalScore]
    check_in_exists: bool  # True if ANY goal has check-ins
    total_possible_score: float  # Sum of all goal weightages (should be 100)


def get_visible_quarters() -> List[str]:
    """
    Get list of quarters that should show scores based on window status ONLY.
    
    WARNING: This function does NOT check snapshot existence. It only considers
    window state. For complete visibility resolution including frozen historical
    quarters, use services.quarter_visibility.resolve_all_quarters_visibility().
    
    This function is kept for backward compatibility with existing code that
    doesn't have database/sheet_id context. New code should use the centralized
    quarter_visibility resolver.
    
    Scores are only visible for quarters whose review window has closed.
    Future quarters never show scores.
    
    Returns:
        List of quarter labels visible based on window state only
        (does NOT include quarters that are only visible due to snapshots)
    """
    from services.quarter_visibility import get_visible_quarters_simple
    return get_visible_quarters_simple()


def _live_goal_score_from_goal_and_checkins(
    goal: Dict[str, Any],
    checkins_raw: List[Dict[str, Any]],
    visible_quarters: List[str],
) -> LiveGoalScore:
    """Build LiveGoalScore from an in-memory goal doc and its check-ins (no DB I/O)."""
    goal_id = str(goal["_id"])
    checkins = [c for c in checkins_raw if c.get("period_label") in visible_quarters]
    if not checkins:
        return LiveGoalScore(
            goal_id=goal_id,
            achievement_pct=None,
            goal_score=None,
            latest_actual_value=None,
            check_in_exists=False,
            visible_quarters=visible_quarters,
        )

    latest_checkin = max(checkins, key=lambda x: x.get("check_in_date", datetime.min))
    progress = calculate_progress(
        uom_type=goal.get("uom_type"),
        target_value=goal.get("target_value"),
        actual_value=latest_checkin.get("actual_value"),
        weightage=float(goal.get("weightage", 0)),
    )

    return LiveGoalScore(
        goal_id=goal_id,
        achievement_pct=progress.achievement_pct,
        goal_score=progress.goal_score,
        latest_actual_value=latest_checkin.get("actual_value"),
        check_in_exists=True,
        visible_quarters=visible_quarters,
    )


async def compute_live_goal_score(
    goal_id: str, 
    db, 
    quarter_filter: Optional[str] = None
) -> LiveGoalScore:
    """
    Compute live score for a single goal based on its check-ins.
    Respects window-aware gating rules.
    
    Args:
        goal_id: Goal ID to compute score for
        db: Database connection
        quarter_filter: Optional quarter to filter check-ins by
    """
    goal = await db[COLLECTION_GOALS].find_one({"_id": ObjectId(goal_id)})
    if not goal:
        raise ValueError(f"Goal {goal_id} not found")

    visible_quarters = get_visible_quarters()

    checkin_query: Dict[str, Any] = {"goal_id": goal_id}
    if quarter_filter:
        checkin_query["period_label"] = quarter_filter

    checkins_raw: List[Dict[str, Any]] = []
    async for checkin in db[COLLECTION_CHECKINS].find(checkin_query):
        checkins_raw.append(checkin)

    return _live_goal_score_from_goal_and_checkins(goal, checkins_raw, visible_quarters)


async def compute_live_sheet_scores_batch(
    sheet_ids: List[str],
    db,
) -> Dict[str, LiveSheetScore]:
    """
    Live scores for many sheets using batched goals + check-in reads ($in queries),
    in-memory grouping, and no per-goal/per-sheet DB calls inside loops.
    """
    unique_sheet_ids = list(dict.fromkeys(sheet_ids))
    if not unique_sheet_ids:
        return {}

    goals_by_sheet: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    async for goal in db[COLLECTION_GOALS].find({"goal_sheet_id": {"$in": unique_sheet_ids}}):
        sid = str(goal.get("goal_sheet_id", ""))
        if sid:
            goals_by_sheet[sid].append(goal)

    all_goal_ids: List[str] = []
    for goals in goals_by_sheet.values():
        for g in goals:
            all_goal_ids.append(str(g["_id"]))

    checkins_by_goal: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    if all_goal_ids:
        async for c in db[COLLECTION_CHECKINS].find({"goal_id": {"$in": all_goal_ids}}):
            gid = str(c.get("goal_id", ""))
            if gid:
                checkins_by_goal[gid].append(c)

    visible_quarters = get_visible_quarters()
    result: Dict[str, LiveSheetScore] = {}

    for sid in unique_sheet_ids:
        goals = goals_by_sheet.get(sid, [])
        if not goals:
            result[sid] = LiveSheetScore(
                sheet_id=sid,
                overall_score=None,
                goal_scores=[],
                check_in_exists=False,
                total_possible_score=0.0,
            )
            continue

        goal_scores: List[LiveGoalScore] = []
        any_checkins_exist = False
        total_score = 0.0
        total_possible_score = sum(float(g.get("weightage", 0)) for g in goals)

        for goal in goals:
            gid = str(goal["_id"])
            live_score = _live_goal_score_from_goal_and_checkins(
                goal,
                checkins_by_goal.get(gid, []),
                visible_quarters,
            )
            goal_scores.append(live_score)

            if live_score.check_in_exists:
                any_checkins_exist = True
                if live_score.goal_score is not None:
                    total_score += live_score.goal_score

        overall_score = round(total_score, 2) if any_checkins_exist else None

        result[sid] = LiveSheetScore(
            sheet_id=sid,
            overall_score=overall_score,
            goal_scores=goal_scores,
            check_in_exists=any_checkins_exist,
            total_possible_score=total_possible_score,
        )

    return result


async def compute_live_sheet_score(sheet_id: str, db) -> LiveSheetScore:
    """
    Compute live overall score for a goal sheet by aggregating goal scores.
    Respects window-aware gating rules.

    Uses the same batched implementation as multi-sheet scoring (one goals query +
    one check-ins query for this sheet's goals).

    Args:
        sheet_id: Goal sheet ID to compute score for
        db: Database connection
    """
    scores = await compute_live_sheet_scores_batch([sheet_id], db)
    return scores.get(
        sheet_id,
        LiveSheetScore(
            sheet_id=sheet_id,
            overall_score=None,
            goal_scores=[],
            check_in_exists=False,
            total_possible_score=0.0,
        ),
    )


async def compute_quarterly_trend(
    goals: List[Dict[str, Any]], 
    checkins: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Compute quarterly trend data with snapshot-aware visibility.
    
    CRITICAL BEHAVIOR (uses centralized quarter visibility resolver):
    - FUTURE quarters: hidden (not included in output)
    - ACTIVE quarters: use LIVE scoring
    - FROZEN quarters: use SNAPSHOT values (ignore mock date)
    - CLOSED quarters without snapshot: hidden
    
    This ensures mock-date rollback does NOT erase frozen historical quarters.
    """
    from app.utils.scoring import calculate_goal_score, calculate_achievement_percentage, UomType
    from database import get_database
    
    # Group goals by sheet_id for batch visibility resolution
    goals_by_sheet = {}
    for g in goals:
        sheet_id = g.get("goal_sheet_id")
        if sheet_id:
            if sheet_id not in goals_by_sheet:
                goals_by_sheet[sheet_id] = []
            goals_by_sheet[sheet_id].append(g)
    
    # Group check-ins by sheet_id
    checkins_by_sheet = {}
    for c in checkins:
        sheet_id = c.get("goal_sheet_id")
        if sheet_id:
            if sheet_id not in checkins_by_sheet:
                checkins_by_sheet[sheet_id] = []
            checkins_by_sheet[sheet_id].append(c)
    
    db = get_database()
    trend_data = []
    
    # Aggregate scores across all sheets with snapshot-aware resolution
    quarter_aggregates = {q: {"planned": 0.0, "actual": 0.0, "checkin_count": 0} for q in ["Q1", "Q2", "Q3", "Q4"]}
    processed_quarters = set()
    
    for sheet_id, sheet_goals in goals_by_sheet.items():
        # Resolve quarter visibility for this sheet (includes snapshot checking)
        from services.quarter_visibility import resolve_all_quarters_visibility
        from services.quarter_snapshots import read_quarter_snapshot
        
        visibility_set = await resolve_all_quarters_visibility(db, sheet_id)
        goals_by_id = {str(g["_id"]): g for g in sheet_goals}
        sheet_checkins = checkins_by_sheet.get(sheet_id, [])
        
        # Process each quarter using centralized visibility resolution
        for quarter_visibility in visibility_set.quarters:
            quarter = quarter_visibility.quarter_label
            
            # Skip quarters that are not visible
            if not quarter_visibility.is_visible:
                continue
            
            processed_quarters.add(quarter)
            
            # FROZEN quarters: use snapshot values (mock-date independent)
            if quarter_visibility.use_snapshot:
                snapshot = await read_quarter_snapshot(db, sheet_id, quarter)
                if snapshot:
                    quarter_aggregates[quarter]["actual"] += snapshot.overall_score
                    quarter_aggregates[quarter]["planned"] += 100.0  # Snapshots are normalized to 100
                    quarter_aggregates[quarter]["checkin_count"] += snapshot.source_check_in_count
                continue
            
            # ACTIVE quarters: use live scoring
            if quarter_visibility.use_live_scoring:
                quarter_checkins = [c for c in sheet_checkins if c.get("period_label") == quarter]
                
                for checkin in quarter_checkins:
                    goal = goals_by_id.get(str(checkin.get("goal_id")))
                    if not goal:
                        continue
                        
                    weightage = float(goal.get("weightage", 0))
                    if weightage <= 0:
                        continue
                    
                    # Calculate achievement percentage
                    achievement_pct = calculate_achievement_percentage(
                        UomType(goal.get("uom_type", "Max")),
                        checkin.get("actual_value"),
                        goal.get("target_value")
                    )
                    
                    # Calculate goal score
                    goal_score = calculate_goal_score(achievement_pct, weightage)
                    
                    quarter_aggregates[quarter]["planned"] += weightage
                    quarter_aggregates[quarter]["actual"] += goal_score
                    quarter_aggregates[quarter]["checkin_count"] += 1
    
    # Build final trend data for visible quarters only
    for quarter in ["Q1", "Q2", "Q3", "Q4"]:
        if quarter in processed_quarters:
            agg = quarter_aggregates[quarter]
            trend_data.append({
                "quarter": quarter,
                "planned": round(agg["planned"], 1),
                "actual": round(agg["actual"], 1),
                "checkin_count": agg["checkin_count"]
            })
    
    return trend_data


def should_hide_scores_for_quarter(quarter: str) -> bool:
    """
    Determine if scores should be hidden for a specific quarter based on window status.
    Scores are hidden during the active review window for that quarter and for future quarters.
    
    Phase 4 Rules:
    - Scores only display after the review window closes
    - Future quarter scores never leak  
    - During goal setting, no quarterly scores are visible
    """
    cycle_status = get_current_cycle_status()
    current_quarter = cycle_status.active_quarter
    
    # If we're in goal setting, hide all quarterly scores
    if current_quarter == QuarterId.GOAL_SETTING:
        return True
    
    # If we're in the review window for this quarter, hide scores
    if current_quarter and current_quarter.value == quarter:
        return True
    
    # Future quarters are always hidden - this ensures future quarter scores never leak
    if current_quarter:
        try:
            current_index = QUARTER_ORDER.index(current_quarter)
            quarter_enum = QuarterId(quarter)
            quarter_index = QUARTER_ORDER.index(quarter_enum)
            
            # Hide quarters that come after the current quarter
            if quarter_index > current_index:
                return True
        except (ValueError, AttributeError):
            # If we can't determine order, err on the side of caution and hide
            return True
    
    return False


def ensure_no_future_quarter_leakage(quarterly_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter quarterly data to ensure future quarter scores never leak.
    This is a safety mechanism for Phase 4.
    """
    visible_quarters = get_visible_quarters()
    filtered_data = []
    
    for quarter_data in quarterly_data:
        quarter = quarter_data.get("quarter")
        if quarter and quarter in visible_quarters:
            filtered_data.append(quarter_data)
    
    return filtered_data


async def enrich_goal_with_live_score(goal_dict: Dict[str, Any], db) -> Dict[str, Any]:
    """
    Enrich a goal dictionary with live computed scores, respecting window gating.
    This replaces any persisted score values with live computations.
    """
    goal_id = str(goal_dict.get("_id", ""))
    if not goal_id:
        return goal_dict
    
    try:
        live_score = await compute_live_goal_score(goal_id, db)
        
        # Replace persisted values with live computations
        goal_dict["achievement_pct"] = live_score.achievement_pct
        goal_dict["goal_score"] = live_score.goal_score
        goal_dict["latest_actual_value"] = live_score.latest_actual_value
        
    except Exception:
        # If live computation fails, ensure nulls
        goal_dict["achievement_pct"] = None
        goal_dict["goal_score"] = None
        goal_dict["latest_actual_value"] = None
    
    return goal_dict


async def enrich_sheet_with_live_score(sheet_dict: Dict[str, Any], db) -> Dict[str, Any]:
    """
    Enrich a goal sheet dictionary with live computed overall score, respecting window gating.
    This replaces any persisted overall_score with live computation.
    
    Phase 4 Rules:
    - If no check-ins exist, overall_score = null and check_in_exists = false
    - Window-aware gating is applied
    """
    sheet_id = str(sheet_dict.get("_id", ""))
    if not sheet_id:
        # Ensure proper null handling
        sheet_dict["overall_score"] = None
        sheet_dict["check_in_exists"] = False
        return sheet_dict
    
    try:
        live_score = await compute_live_sheet_score(sheet_id, db)
        
        # Replace persisted values with live computation
        sheet_dict["overall_score"] = live_score.overall_score
        sheet_dict["check_in_exists"] = live_score.check_in_exists
        
    except Exception:
        # If live computation fails, ensure proper nulls per Phase 4
        sheet_dict["overall_score"] = None
        sheet_dict["check_in_exists"] = False
    
    return sheet_dict