"""
Employee Dashboard router.

Provides dashboard data for employees including goal sheet status,
quarterly score trends, and window-aware score visibility.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from auth import get_current_user
from database import COLLECTION_CHECKINS, COLLECTION_GOAL_SHEETS, COLLECTION_GOALS, get_database
from models.user import TokenData, UserRole
from services.live_scoring import compute_live_sheet_score, get_visible_quarters, ensure_no_future_quarter_leakage
from services.checkin_window import get_current_cycle_status

router = APIRouter(prefix="/api/employee/dashboard", tags=["Employee Dashboard"])


@router.get("/summary")
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
            "visible_quarters": get_visible_quarters()
        }
    
    sheet = sheets[0]
    sheet_id = str(sheet["_id"])
    
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
    
    # Get quarterly scores with window-aware visibility
    quarterly_scores = await _compute_quarterly_scores_for_sheet(sheet_id, db)
    
    return {
        "sheet": sheet,
        "quarterly_scores": quarterly_scores,
        "window_status": get_current_cycle_status().to_dict(),
        "visible_quarters": get_visible_quarters()
    }


async def _compute_quarterly_scores_for_sheet(sheet_id: str, db) -> List[Dict[str, Any]]:
    """
    Compute quarterly score trend for a specific sheet with window-aware visibility.
    Only shows scores for quarters whose review windows have closed.
    """
    from app.utils.scoring import calculate_goal_score, calculate_achievement_percentage, UomType
    
    # Get goals for this sheet
    goals = []
    async for goal in db[COLLECTION_GOALS].find({"goal_sheet_id": sheet_id}):
        goals.append(goal)
    
    if not goals:
        return []
    
    # Get check-ins for this sheet
    checkins = []
    async for checkin in db[COLLECTION_CHECKINS].find({"goal_sheet_id": sheet_id}):
        checkins.append(checkin)
    
    goals_by_id = {str(g["_id"]): g for g in goals}
    visible_quarters = get_visible_quarters()
    quarterly_scores = []
    
    for quarter in ["Q1", "Q2", "Q3", "Q4"]:
        # Check if this quarter should be visible
        if quarter not in visible_quarters:
            continue
            
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
                "checkin_count": len(quarter_checkins)
            })
    
    # Apply future quarter leakage protection
    return ensure_no_future_quarter_leakage(quarterly_scores)