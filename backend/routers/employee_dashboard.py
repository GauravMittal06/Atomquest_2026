"""
Employee Dashboard router.

Provides dashboard data for employees including goal sheet status,
quarterly score trends, and window-aware score visibility with snapshot support.

Uses centralized quarter visibility resolution to properly handle:
- Future quarters (hidden)
- Active quarters (live scoring)
- Frozen quarters (snapshot values)
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from auth import get_current_user
from database import COLLECTION_CHECKINS, COLLECTION_GOAL_SHEETS, COLLECTION_GOALS, get_database
from models.user import TokenData, UserRole
from services.live_scoring import compute_live_sheet_score, ensure_no_future_quarter_leakage
from services.checkin_window import get_current_cycle_status
from services.quarter_visibility import resolve_all_quarters_visibility
from services.quarter_snapshots import read_quarter_snapshot

router = APIRouter(prefix="/api/employee/dashboard", tags=["Employee Dashboard"])


@router.get("", response_model=EmployeeDashboardMetrics)
async def get_employee_dashboard_summary(
    current: TokenData = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Get employee dashboard summary with live computed scores and window-aware visibility.
    
    Returns:
    - Latest goal sheet with live overall_score
    - Quarterly score trend with window-aware visibility
    - Check-in window status
    """
    db = get_database()
    
    # Get employee's latest goal sheet
    sheets = []
    async for sheet in db[COLLECTION_GOAL_SHEETS].find(
        {"employee_id": current.user_id}
    ).sort("updated_at", -1).limit(1):
        sheets.append(sheet)
    
    if not sheets:
        return {
            "sheet": None,
            "quarterly_scores": [],
            "window_status": get_current_cycle_status().to_dict(),
            "visible_quarters": []
        }
    
    sheet = sheets[0]
    sheet_id = str(sheet["_id"])
    
    # Resolve quarter visibility for this sheet (includes snapshot checking)
    visibility_set = await resolve_all_quarters_visibility(db, sheet_id)
    
    # Get live sheet score
    try:
        live_sheet_score = await compute_live_sheet_score(sheet_id, db)
        sheet["overall_score"] = live_sheet_score.overall_score
        sheet["check_in_exists"] = live_sheet_score.check_in_exists
    except Exception:
        sheet["overall_score"] = None
        sheet["check_in_exists"] = False
    
    # Serialize sheet
    sheet["_id"] = str(sheet["_id"])
    
    # Get quarterly scores with centralized visibility resolution
    quarterly_scores = await _compute_quarterly_scores_with_snapshots(
        sheet_id, db, visibility_set
    )
    
    return {
        "sheet": sheet,
        "quarterly_scores": quarterly_scores,
        "window_status": get_current_cycle_status().to_dict(),
        "visible_quarters": visibility_set.visible_quarter_labels
    }


async def _compute_quarterly_scores_with_snapshots(
    sheet_id: str,
    db,
    visibility_set,
) -> List[Dict[str, Any]]:
    """
    Compute quarterly score trend using centralized visibility resolution.
    
    CRITICAL BEHAVIOR:
    - FUTURE quarters: hidden (not included in output)
    - ACTIVE quarters: use LIVE scoring
    - FROZEN quarters: use SNAPSHOT values (ignore mock date)
    - CLOSED quarters without snapshot: hidden
    
    This ensures mock-date rollback does NOT erase frozen historical quarters.
    
    Args:
        sheet_id: Goal sheet ID
        db: Database connection
        visibility_set: Resolved quarter visibility from resolve_all_quarters_visibility()
    
    Returns:
        List of quarterly score data for visible quarters only
    """
    from app.utils.scoring import calculate_goal_score, calculate_achievement_percentage, UomType
    
    # Get goals for this sheet
    goals = []
    async for goal in db[COLLECTION_GOALS].find({"goal_sheet_id": sheet_id}):
        goals.append(goal)
    
    if not goals:
        return []
    
    # Get check-ins for this sheet (needed for live quarters)
    checkins = []
    async for checkin in db[COLLECTION_CHECKINS].find({"goal_sheet_id": sheet_id}):
        checkins.append(checkin)
    
    goals_by_id = {str(g["_id"]): g for g in goals}
    quarterly_scores = []
    
    # Process each quarter using centralized visibility resolution
    for quarter_visibility in visibility_set.quarters:
        quarter = quarter_visibility.quarter_label
        
        # Skip quarters that are not visible
        if not quarter_visibility.is_visible:
            continue
        
        # FROZEN quarters: use snapshot values (mock-date independent)
        if quarter_visibility.use_snapshot:
            snapshot = await read_quarter_snapshot(db, sheet_id, quarter)
            if snapshot:
                quarterly_scores.append({
                    "quarter": quarter,
                    "score": round(snapshot.overall_score, 1),
                    "max_possible": 100.0,  # Snapshots are already normalized
                    "checkin_count": snapshot.source_check_in_count,
                    "is_frozen": True,
                    "frozen_at": snapshot.frozen_at.isoformat() if snapshot.frozen_at else None,
                })
            continue
        
        # ACTIVE quarters: use live scoring
        if quarter_visibility.use_live_scoring:
            total_score = 0.0
            total_weightage = 0.0
            has_checkins = False
            
            # Get check-ins for this quarter
            quarter_checkins = [c for c in checkins if c.get("period_label") == quarter]
            
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
                
                total_score += goal_score
                total_weightage += weightage
                has_checkins = True
            
            # Only include quarters that have check-ins
            if has_checkins:
                quarterly_scores.append({
                    "quarter": quarter,
                    "score": round(total_score, 1),
                    "max_possible": round(total_weightage, 1),
                    "checkin_count": len(quarter_checkins),
                    "is_frozen": False,
                })
    
    return quarterly_scores