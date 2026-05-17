"""
Progress calculator service.

Implements the canonical achievement-percentage and goal-score formulas as
defined in docs/VALIDATION_RULES.md §UoM Types.

This module is the **single source of truth** for progress maths. Routers and
seed scripts MUST go through ``calculate_progress`` rather than reproducing the
arithmetic inline.

Supported UoM types
-------------------
- ``Max``      higher actual is better (revenue, conversions, ...)
- ``Min``      lower actual is better (defects, downtime, cost, ...)
- ``Timeline`` actual delivery date vs. target date — 5-pt penalty per day late
- ``Zero``     binary Yes/No outcome
- ``Numeric``  legacy alias for ``Max``

Returned values
---------------
- ``achievement_pct`` clamped to the range [0, 100] with two-decimal precision.
- ``goal_score``      = (achievement_pct / 100) * weightage, four-decimal precision.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Optional

from models.goal import UoMType


# Timeline lateness penalty in percentage points per calendar day late.
# docs/VALIDATION_RULES.md §3 — a goal is fully missed after 20 days late.
TIMELINE_PENALTY_PER_DAY: float = 5.0


@dataclass(frozen=True)
class ProgressResult:
    """Outcome of running a check-in's actual_value through the formulas."""

    achievement_pct: Optional[float]
    goal_score: Optional[float]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def calculate_achievement_pct(
    uom_type: str | UoMType,
    target_value: Any,
    actual_value: Any,
) -> Optional[float]:
    """
    Return achievement % per docs/VALIDATION_RULES.md.

    Returns ``None`` when inputs cannot be evaluated (e.g. non-numeric actual on
    a Max goal). Returns ``0.0`` when an evaluable input fails the goal
    outright (e.g. "No" vs "Yes" on a Zero goal).
    """
    uom = _normalise_uom(uom_type)
    if actual_value is None or actual_value == "":
        return None

    if uom in (UoMType.MAX, UoMType.NUMERIC):
        return _max_pct(target_value, actual_value)

    if uom == UoMType.MIN:
        return _min_pct(target_value, actual_value)

    if uom == UoMType.TIMELINE:
        return _timeline_pct(target_value, actual_value)

    if uom == UoMType.ZERO:
        return _zero_pct(target_value, actual_value)

    return None


def calculate_goal_score(achievement_pct: Optional[float], weightage: float) -> Optional[float]:
    """
    Score contributed by a single goal toward the sheet's overall score.

    ``goal_score = (achievement_pct / 100) * weightage``  (VALIDATION_RULES.md)
    """
    if achievement_pct is None:
        return None
    try:
        w = float(weightage)
    except (TypeError, ValueError):
        return None
    return round((achievement_pct / 100.0) * w, 4)


def calculate_progress(
    uom_type: str | UoMType,
    target_value: Any,
    actual_value: Any,
    weightage: float,
) -> ProgressResult:
    """Convenience wrapper returning both achievement % and goal score."""
    pct = calculate_achievement_pct(uom_type, target_value, actual_value)
    score = calculate_goal_score(pct, weightage)
    return ProgressResult(achievement_pct=pct, goal_score=score)


# ---------------------------------------------------------------------------
# Internal helpers — one per UoM type
# ---------------------------------------------------------------------------

def _normalise_uom(uom_type: str | UoMType) -> UoMType | None:
    if isinstance(uom_type, UoMType):
        return uom_type
    try:
        return UoMType(uom_type)
    except ValueError:
        return None


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp_pct(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 2)


def _max_pct(target: Any, actual: Any) -> Optional[float]:
    t = _to_float(target)
    a = _to_float(actual)
    if t is None or a is None:
        return None
    if t <= 0:
        return 0.0
    return _clamp_pct((a / t) * 100.0)


def _min_pct(target: Any, actual: Any) -> Optional[float]:
    t = _to_float(target)
    a = _to_float(actual)
    if t is None or a is None:
        return None
    if a <= 0:
        # Zero (or negative) defect/cost is the best possible outcome.
        return 100.0
    if t < 0:
        return 0.0
    return _clamp_pct((t / a) * 100.0)


def _timeline_pct(target: Any, actual: Any) -> Optional[float]:
    target_date = _parse_date(target)
    actual_date = _parse_date(actual)
    if target_date is None or actual_date is None:
        return None
    days_late = (actual_date - target_date).days
    if days_late <= 0:
        return 100.0
    return _clamp_pct(100.0 - days_late * TIMELINE_PENALTY_PER_DAY)


def _zero_pct(target: Any, actual: Any) -> Optional[float]:
    t = str(target).strip().lower() if target is not None else ""
    a = str(actual).strip().lower() if actual is not None else ""
    if t not in ("yes", "no") or a not in ("yes", "no"):
        return None
    return 100.0 if t == a else 0.0


def _parse_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    # Accept "YYYY-MM-DD" or any ISO-formatted string
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None
