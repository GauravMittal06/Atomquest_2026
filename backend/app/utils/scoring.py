"""
Scoring Authority for AtomQuest Goal Tracking Portal

This module contains the canonical scoring formulas for all UoM (Unit of Measure) types.
These formulas calculate achievement percentages and goal scores according to the
business rules defined in docs/VALIDATION_RULES.md.

The goal score for any goal is always:
goal_score = (achievement_pct / 100) * weightage
"""

from datetime import datetime, date
from typing import Union, Optional
from enum import Enum


class UomType(str, Enum):
    """Unit of Measure types for goal scoring"""
    MAX = "Max"
    MIN = "Min"
    TIMELINE = "Timeline"
    ZERO = "Zero"
    NUMERIC = "Numeric"  # Legacy type, treated as MAX


def calculate_achievement_percentage(
    uom_type: UomType,
    actual: Union[float, str, None],
    target: Union[float, str],
) -> float:
    """
    Calculate achievement percentage based on UoM type and actual vs target values.
    
    Args:
        uom_type: The Unit of Measure type
        actual: The actual value achieved (can be numeric, date string, or Yes/No)
        target: The target value (can be numeric, date string, or Yes/No)
    
    Returns:
        Achievement percentage (0-100)
    """
    
    if uom_type == UomType.MAX or uom_type == UomType.NUMERIC:
        return _calculate_max_achievement(actual, target)
    elif uom_type == UomType.MIN:
        return _calculate_min_achievement(actual, target)
    elif uom_type == UomType.TIMELINE:
        return _calculate_timeline_achievement(actual, target)
    elif uom_type == UomType.ZERO:
        return _calculate_zero_achievement(actual, target)
    else:
        raise ValueError(f"Unknown UoM type: {uom_type}")


def _calculate_max_achievement(actual: Union[float, None], target: float) -> float:
    """
    Max UoM: "higher is better"
    Used when a larger Actual outperforms the Target (e.g. revenue, conversions).
    
    Formula:
    achievement_pct = min(100, (Actual / Target) * 100)  if Target > 0
    achievement_pct = 0                                  if Target <= 0 or Actual is missing
    """
    if actual is None or target <= 0:
        return 0.0
    
    try:
        actual_num = float(actual)
        target_num = float(target)
        return min(100.0, (actual_num / target_num) * 100)
    except (ValueError, TypeError, ZeroDivisionError):
        return 0.0


def _calculate_min_achievement(actual: Union[float, None], target: float) -> float:
    """
    Min UoM: "lower is better"
    Used when a smaller Actual outperforms the Target (e.g. defects, downtime, cost).
    
    Formula:
    achievement_pct = 100                                if Actual <= 0
    achievement_pct = min(100, (Target / Actual) * 100)  if Actual > 0 and Target >= 0
    """
    if actual is None:
        return 0.0
    
    try:
        actual_num = float(actual)
        target_num = float(target)
        
        if actual_num <= 0:
            return 100.0
        
        if actual_num > 0 and target_num >= 0:
            return min(100.0, (target_num / actual_num) * 100)
        
        return 0.0
    except (ValueError, TypeError, ZeroDivisionError):
        return 0.0


def _calculate_timeline_achievement(actual: Union[str, None], target: str) -> float:
    """
    Timeline UoM: "on-time vs. target date"
    Target is an ISO date string (YYYY-MM-DD). Actual is the date work was completed.
    
    Formula:
    delivered_on_or_before_target  => achievement_pct = 100
    delivered_after_target         => achievement_pct = max(0, 100 - days_late * 5)
    not_delivered                  => achievement_pct = 0
    
    A 5-point penalty per day late means a goal is fully missed after 20 days.
    """
    if actual is None or actual == "":
        return 0.0  # not delivered
    
    try:
        # Parse ISO date strings
        target_date = datetime.fromisoformat(target.replace('Z', '+00:00')).date()
        actual_date = datetime.fromisoformat(actual.replace('Z', '+00:00')).date()
        
        if actual_date <= target_date:
            return 100.0  # delivered on or before target
        
        # Calculate days late
        days_late = (actual_date - target_date).days
        return max(0.0, 100.0 - days_late * 5)
        
    except (ValueError, TypeError):
        return 0.0


def _calculate_zero_achievement(actual: Union[str, None], target: str) -> float:
    """
    Zero UoM: binary outcome
    Target is "Yes" or "No". Actual is "Yes" or "No".
    
    Formula:
    Actual == Target  => achievement_pct = 100
    Actual != Target  => achievement_pct = 0
    """
    if actual is None:
        return 0.0
    
    try:
        actual_str = str(actual).strip()
        target_str = str(target).strip()
        
        return 100.0 if actual_str == target_str else 0.0
    except (ValueError, TypeError):
        return 0.0


def calculate_goal_score(achievement_pct: float, weightage: float) -> float:
    """
    Calculate the goal score for the quarter.
    
    Formula:
    goal_score = (achievement_pct / 100) * weightage
    
    Args:
        achievement_pct: Achievement percentage (0-100)
        weightage: Goal weightage (0-100)
    
    Returns:
        Goal score (0 to weightage value)
    """
    return (achievement_pct / 100) * weightage


def calculate_total_score(goal_scores: list[float]) -> float:
    """
    Calculate total score by summing all individual goal scores.
    
    Args:
        goal_scores: List of individual goal scores
    
    Returns:
        Total score (0-100 when all weightages sum to 100%)
    """
    return sum(goal_scores)


# Validation helpers
def validate_total_weightage(weightages: list[float]) -> bool:
    """Validate that total goal weightage equals exactly 100%"""
    return abs(sum(weightages) - 100.0) < 0.01  # Allow for floating point precision


def validate_individual_weightage(weightage: float) -> bool:
    """Validate that individual goal weightage is at least 10%"""
    return weightage >= 10.0


def validate_max_goals(goal_count: int) -> bool:
    """Validate that employee has maximum 8 goals"""
    return goal_count <= 8