"""
Pydantic models for Check-in entity.

Rules sourced from docs/CHECKIN_RULES.md.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Optional

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class PeriodLabel(str, Enum):
    """Standard annual review period labels (docs/CHECKIN_RULES.md §3)."""
    Q1 = "Q1"
    Q2 = "Q2"
    MID_YEAR = "MID_YEAR"
    Q3 = "Q3"
    Q4 = "Q4"
    YEAR_END = "YEAR_END"


# ---------------------------------------------------------------------------
# Base model
# ---------------------------------------------------------------------------

class CheckInBase(BaseModel):
    goal_id: str
    period_label: PeriodLabel
    actual_value: Any  # Numeric for QUANTITATIVE, text for QUALITATIVE
    self_rating: Optional[Annotated[float, Field(ge=0.0, le=5.0)]] = None
    remarks: Optional[Annotated[str, Field(max_length=1000)]] = None

    @model_validator(mode="after")
    def validate_self_rating_increments(self) -> "CheckInBase":
        if self.self_rating is not None:
            # Must be in increments of 1.0 (0, 1, 2, 3, 4, 5)
            if self.self_rating not in {0.0, 1.0, 2.0, 3.0, 4.0, 5.0}:
                raise ValueError("self_rating must be one of 0, 1, 2, 3, 4, 5")
        return self


# ---------------------------------------------------------------------------
# DB document model
# ---------------------------------------------------------------------------

class CheckInInDB(CheckInBase):
    id: Optional[str] = Field(default=None, alias="_id")
    goal_sheet_id: str      # Denormalised for query efficiency
    created_by: str         # User._id of employee
    check_in_date: datetime = Field(default_factory=datetime.utcnow)
    manager_remark: Optional[Annotated[str, Field(max_length=500)]] = None
    manager_id: Optional[str] = None
    is_editable: bool = True  # Becomes False after 24-hour grace window

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class CheckInCreate(CheckInBase):
    pass


class CheckInUpdate(BaseModel):
    """Allowed within 24-hour grace window (CHECKIN_RULES.md §4)."""
    actual_value: Optional[Any] = None
    self_rating: Optional[Annotated[float, Field(ge=0.0, le=5.0)]] = None
    remarks: Optional[Annotated[str, Field(max_length=1000)]] = None


class ManagerRemarkUpdate(BaseModel):
    """Manager can add/update a remark on any check-in (CHECKIN_RULES.md §8)."""
    manager_remark: Annotated[str, Field(max_length=500)]


class CheckInPublic(CheckInBase):
    id: Optional[str] = Field(default=None, alias="_id")
    goal_sheet_id: str
    created_by: str
    check_in_date: Optional[datetime] = None
    manager_remark: Optional[str] = None
    is_editable: bool = True

    model_config = {"populate_by_name": True}
