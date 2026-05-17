"""
Quarterly check-in window service.

Implements the calendar defined in docs/CHECKIN_RULES.md §Allowed Check-in Windows:

    Goal Setting → May
    Q1           → July
    Q2           → October
    Q3           → January
    Q4           → March / April

Outside an active window all check-in achievement inputs MUST be read-only
(CHECKIN_RULES.md §Restrictions). The frontend renders a status banner sourced
from :data:`CYCLE_BANNER_BY_STATE`.

An Admin may override the "current system date" purely for demo/testing
purposes via :func:`set_mock_date_override`. The override is process-local
and not persisted to MongoDB — refreshing the API restores the real clock.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Quarter identifiers & calendar
# ---------------------------------------------------------------------------

class QuarterId(str, Enum):
    """Quarter identifiers as referenced in docs/CHECKIN_RULES.md."""

    GOAL_SETTING = "GOAL_SETTING"
    Q1 = "Q1"
    Q2 = "Q2"
    Q3 = "Q3"
    Q4 = "Q4"


# (quarter_id, opens-on-month, closes-on-month-inclusive)
# Q4 spans March-April per CHECKIN_RULES.md §Allowed Check-in Windows.
QUARTER_WINDOW_SCHEDULE: list[tuple[QuarterId, int, int]] = [
    (QuarterId.GOAL_SETTING, 5, 5),    # May
    (QuarterId.Q1, 7, 7),              # July
    (QuarterId.Q2, 10, 10),            # October
    (QuarterId.Q3, 1, 1),              # January
    (QuarterId.Q4, 3, 4),              # March-April
]


# ---------------------------------------------------------------------------
# Cycle state machine
# ---------------------------------------------------------------------------

class CycleState(str, Enum):
    """High-level status of the appraisal calendar at a given moment."""

    GOAL_SETTING_OPEN = "GOAL_SETTING_OPEN"
    Q1_OPEN = "Q1_OPEN"
    Q2_OPEN = "Q2_OPEN"
    Q3_OPEN = "Q3_OPEN"
    Q4_OPEN = "Q4_OPEN"
    BETWEEN_WINDOWS = "BETWEEN_WINDOWS"


CYCLE_BANNER_BY_STATE: dict[CycleState, dict[str, str]] = {
    CycleState.GOAL_SETTING_OPEN: {
        "tone": "blue",
        "title": "Goal-Setting Window Open",
        "message": "Define your goals for the new appraisal cycle. Check-in inputs are read-only this month.",
    },
    CycleState.Q1_OPEN: {
        "tone": "green",
        "title": "Q1 Check-in Window Open",
        "message": "Record your Q1 (Apr–Jun) achievements. Inputs are editable through July.",
    },
    CycleState.Q2_OPEN: {
        "tone": "green",
        "title": "Q2 Check-in Window Open",
        "message": "Record your Q2 (Jul–Sep) achievements. Inputs are editable through October.",
    },
    CycleState.Q3_OPEN: {
        "tone": "green",
        "title": "Q3 Check-in Window Open",
        "message": "Record your Q3 (Oct–Dec) achievements. Inputs are editable through January.",
    },
    CycleState.Q4_OPEN: {
        "tone": "green",
        "title": "Q4 Check-in Window Open",
        "message": "Record your Q4 (Jan–Mar) achievements. Inputs are editable through April.",
    },
    CycleState.BETWEEN_WINDOWS: {
        "tone": "amber",
        "title": "Check-in Window Closed",
        "message": "Achievement inputs are read-only outside the active quarterly window.",
    },
}


@dataclass(frozen=True)
class CycleStatus:
    """A point-in-time snapshot of the check-in calendar."""

    today: date
    state: CycleState
    active_quarter: Optional[QuarterId]
    next_quarter: Optional[QuarterId]
    next_window_opens: Optional[date]
    banner_tone: str
    banner_title: str
    banner_message: str
    is_mocked: bool

    def to_dict(self) -> dict:
        return {
            "today": self.today.isoformat(),
            "state": self.state.value,
            "active_quarter": self.active_quarter.value if self.active_quarter else None,
            "next_quarter": self.next_quarter.value if self.next_quarter else None,
            "next_window_opens": (
                self.next_window_opens.isoformat() if self.next_window_opens else None
            ),
            "banner_tone": self.banner_tone,
            "banner_title": self.banner_title,
            "banner_message": self.banner_message,
            "is_mocked": self.is_mocked,
        }


# ---------------------------------------------------------------------------
# Mock-date override (Admin-only demo helper)
# ---------------------------------------------------------------------------

_mock_date_override: Optional[date] = None


def set_mock_date_override(value: Optional[date]) -> None:
    """Override the "current date" for demo purposes. Pass ``None`` to clear."""
    global _mock_date_override
    _mock_date_override = value


def get_mock_date_override() -> Optional[date]:
    """Return the active mock-date override, if any."""
    return _mock_date_override


def today_in_cycle() -> tuple[date, bool]:
    """Return ``(today, is_mocked)`` for the cycle service."""
    if _mock_date_override is not None:
        return _mock_date_override, True
    return datetime.now(timezone.utc).date(), False


# ---------------------------------------------------------------------------
# Window queries
# ---------------------------------------------------------------------------

def _quarter_for_month(month: int) -> Optional[QuarterId]:
    for quarter, opens, closes in QUARTER_WINDOW_SCHEDULE:
        if opens <= month <= closes:
            return quarter
    return None


def is_input_window_open(at: Optional[date] = None) -> bool:
    """``True`` when achievement inputs may be edited (a quarter is open)."""
    target = at or today_in_cycle()[0]
    quarter = _quarter_for_month(target.month)
    return quarter is not None and quarter != QuarterId.GOAL_SETTING


def get_current_cycle_status(at: Optional[date] = None) -> CycleStatus:
    """Compute the cycle state for the given (or current) date."""
    if at is None:
        today, is_mocked = today_in_cycle()
    else:
        today, is_mocked = at, False

    quarter = _quarter_for_month(today.month)

    state: CycleState
    if quarter == QuarterId.GOAL_SETTING:
        state = CycleState.GOAL_SETTING_OPEN
    elif quarter == QuarterId.Q1:
        state = CycleState.Q1_OPEN
    elif quarter == QuarterId.Q2:
        state = CycleState.Q2_OPEN
    elif quarter == QuarterId.Q3:
        state = CycleState.Q3_OPEN
    elif quarter == QuarterId.Q4:
        state = CycleState.Q4_OPEN
    else:
        state = CycleState.BETWEEN_WINDOWS

    banner = CYCLE_BANNER_BY_STATE[state]
    next_quarter, next_open = _next_window(today)

    return CycleStatus(
        today=today,
        state=state,
        active_quarter=quarter,
        next_quarter=next_quarter,
        next_window_opens=next_open,
        banner_tone=banner["tone"],
        banner_title=banner["title"],
        banner_message=banner["message"],
        is_mocked=is_mocked,
    )


def _next_window(at: date) -> tuple[Optional[QuarterId], Optional[date]]:
    """Return the next (quarter, opening date) on or after ``at``."""
    for offset in range(0, 13):
        m = ((at.month - 1 + offset) % 12) + 1
        year = at.year + (at.month - 1 + offset) // 12
        quarter = _quarter_for_month(m)
        if quarter is None:
            continue
        opens = next(opens for (q, opens, _) in QUARTER_WINDOW_SCHEDULE if q == quarter)
        opening_date = date(year, opens, 1)
        if opening_date >= date(at.year, at.month, 1):
            # Skip the currently-open quarter unless we're past its month entirely
            if offset == 0 and quarter == _quarter_for_month(at.month):
                continue
            return quarter, opening_date
    return None, None
