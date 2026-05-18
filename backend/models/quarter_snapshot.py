"""
Immutable quarterly score snapshots embedded on goal sheet documents.

Stored under `quarter_snapshots` on each goal_sheets document (additive, optional).
Not exposed on GoalSheetPublic yet; see services.quarter_snapshots for read/write helpers.

Snapshots are append-only: after creation, locked=True and must not be updated via application code.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class QuarterSnapshotGoalFrozen(BaseModel):
    """Per-goal frozen metrics for one quarter."""

    model_config = ConfigDict(extra="ignore")

    goal_id: str
    goal_score: float = Field(description="Frozen weighted goal score for this quarter.")
    achievement_pct: float = Field(description="Frozen achievement percentage (0–100+).")
    actual_value: Optional[Any] = Field(
        default=None,
        description="Frozen actual value from the check-in (any JSON-serializable shape).",
    )


class QuarterSnapshot(BaseModel):
    """
    One immutable snapshot for a fiscal quarter on a goal sheet.

    `locked` must be True when persisted; the write helper enforces this.
    """

    model_config = ConfigDict(extra="ignore")

    quarter_label: str = Field(min_length=1, description='Quarter label, e.g. "Q1"')
    overall_score: float = Field(description="Frozen aggregate sheet score for this quarter.")
    goals: List[QuarterSnapshotGoalFrozen] = Field(
        default_factory=list,
        description="Frozen per-goal scores and actuals for this quarter.",
    )
    frozen_at: datetime = Field(description="UTC timestamp when the snapshot was taken.")
    frozen_by: str = Field(min_length=1, description="User id of whoever froze the snapshot.")
    source_check_in_count: int = Field(
        ge=0,
        description="Number of check-in records that informed this snapshot.",
    )
    locked: bool = Field(
        default=True,
        description="Immutable flag; always True once written.",
    )

    @field_validator("locked")
    @classmethod
    def _locked_must_be_true(cls, v: bool) -> bool:
        if not v:
            raise ValueError("QuarterSnapshot.locked must be True (snapshots are immutable).")
        return v
