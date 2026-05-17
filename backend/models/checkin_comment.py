"""
Pydantic models for the structured Manager Check-in Comment.

Required fields per the brief:
  - author (manager / admin user id, captured server-side)
  - timestamp (server-side, UTC)
  - quarter identifier (Q1/Q2/Q3/Q4 from docs/CHECKIN_RULES.md)

Scope of the comment is one (employee + goal_sheet + quarter) tuple, so the
manager can leave one review note per team member per quarter. Multiple notes
are allowed and the timeline is preserved.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, Field

from models.check_in import PeriodLabel


class CheckinCommentCreate(BaseModel):
    """Payload posted by a Manager / Admin when leaving a review note."""

    goal_sheet_id: Annotated[str, Field(min_length=1)]
    employee_id: Annotated[str, Field(min_length=1)]
    quarter: PeriodLabel
    comment: Annotated[str, Field(min_length=1, max_length=2000)]


class CheckinCommentInDB(CheckinCommentCreate):
    id: Optional[str] = Field(default=None, alias="_id")
    author_id: str
    author_role: str
    author_name: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


class CheckinCommentPublic(CheckinCommentInDB):
    """Same shape as the DB document — safe to return to clients."""
