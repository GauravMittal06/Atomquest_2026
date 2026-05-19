"""
Cycles router — cycle status and on-the-fly quarter score snapshots.
"""

from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Depends

from auth import get_current_user
from database import COLLECTION_CHECKINS, COLLECTION_GOALS, get_database
from models.user import TokenData
from services.checkin_window import get_current_cycle_status, is_input_window_open

router = APIRouter(prefix="/api", tags=["Cycles"])


@router.get("/cycle-status")
async def get_cycle_status(_: TokenData = Depends(get_current_user)) -> dict:
    """Current active quarter and window state for quarter visibility."""
    cycle = get_current_cycle_status()
    return {
        "active_quarter": cycle.active_quarter.value if cycle.active_quarter else None,
        "is_window_open": is_input_window_open(),
    }


@router.get("/quarter-snapshots/{sheet_id}/{quarter}")
async def get_quarter_snapshot(
    sheet_id: str,
    quarter: str,
    _: TokenData = Depends(get_current_user),
):
    """
    Returns quarter snapshot with computed goal scores.
    Fetches check-ins and goals, computes achievement_pct and goal_score based on UoM type.
    """
    db = get_database()

    checkins = await db[COLLECTION_CHECKINS].find({
        "goal_sheet_id": sheet_id,
        "period_label": quarter,
    }).to_list(None)

    if not checkins:
        return {
            "quarter_label": quarter,
            "overall_score": 0,
            "goals": [],
            "frozen_at": None,
            "frozen_by": None,
            "source_check_in_count": 0,
            "locked": False,
        }

    goals_data = []
    total_score = 0

    for ci in checkins:
        goal = await db[COLLECTION_GOALS].find_one({"_id": ObjectId(ci["goal_id"])})
        if not goal:
            continue

        actual = ci.get("actual_value")
        target = goal.get("target_value")
        weightage = goal.get("weightage", 0)
        uom_type = goal.get("uom_type")

        if uom_type == "Zero":
            achievement_pct = 100 if actual == "Yes" else 0
        else:
            if uom_type == "Timeline":
                achievement_pct = 100 if actual else 0
            elif target and isinstance(target, (int, float)) and target > 0:
                achievement_pct = min(100, (actual / target * 100))
            else:
                achievement_pct = 0

        goal_score = (achievement_pct / 100) * weightage
        total_score += goal_score

        goals_data.append({
            "goal_id": str(ci["goal_id"]),
            "goal_score": round(goal_score, 2),
            "achievement_pct": round(achievement_pct, 2),
            "actual_value": actual,
        })

    return {
        "quarter_label": quarter,
        "overall_score": round(total_score, 2),
        "goals": goals_data,
        "frozen_at": None,
        "frozen_by": None,
        "source_check_in_count": len(checkins),
        "locked": False,
    }
