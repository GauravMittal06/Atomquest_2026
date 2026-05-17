"""
Pydantic models for GoalSheet entity.

State machine is defined in docs/WORKFLOWS.md.
Status badge colours:
  DRAFT → grey  |  SUBMITTED → blue  |  RETURNED → amber
  APPROVED → green  |  LOCKED → purple
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Enums — in sync with WORKFLOWS.md state machine
# ---------------------------------------------------------------------------

class GoalSheetStatus(str, Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    RETURNED = "RETURNED"
    APPROVED = "APPROVED"
    LOCKED = "LOCKED"


# Badge colour mapping (used by frontend; kept here as documentation)
STATUS_BADGE_COLOUR: dict[GoalSheetStatus, str] = {
    GoalSheetStatus.DRAFT: "grey",
    GoalSheetStatus.SUBMITTED: "blue",
    GoalSheetStatus.RETURNED: "amber",
    GoalSheetStatus.APPROVED: "green",
    GoalSheetStatus.LOCKED: "purple",
}

# Valid state transitions — source: docs/WORKFLOWS.md §1
ALLOWED_TRANSITIONS: dict[GoalSheetStatus, list[GoalSheetStatus]] = {
    GoalSheetStatus.DRAFT: [GoalSheetStatus.SUBMITTED],
    GoalSheetStatus.SUBMITTED: [GoalSheetStatus.APPROVED, GoalSheetStatus.RETURNED],
    GoalSheetStatus.RETURNED: [GoalSheetStatus.SUBMITTED],
    GoalSheetStatus.APPROVED: [GoalSheetStatus.LOCKED],
    GoalSheetStatus.LOCKED: [],
}


# ---------------------------------------------------------------------------
# Audit log entry (embedded in GoalSheet document)
# ---------------------------------------------------------------------------

class AuditLogEntry(BaseModel):
    # str (not GoalSheetStatus) so special actions like 'UNLOCKED' can be recorded
    # alongside the normal workflow status transitions.
    action: str
    actor_id: str
    actor_role: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    comment: Optional[Annotated[str, Field(max_length=1000)]] = None


# ---------------------------------------------------------------------------
# GoalSheet base
# ---------------------------------------------------------------------------

class GoalSheetBase(BaseModel):
    period_id: str          # Reference to AppraisalPeriod
    period_label: str       # Human-readable label, e.g. "FY 2025-26"


# ---------------------------------------------------------------------------
# DB document model
# ---------------------------------------------------------------------------

class GoalSheetInDB(GoalSheetBase):
    id: Optional[str] = Field(default=None, alias="_id")
    employee_id: str            # Reference to User (owner)
    status: GoalSheetStatus = GoalSheetStatus.DRAFT

    # Cached goal count and total weightage (recomputed on goal add/update/delete)
    goal_count: int = 0
    total_weightage: float = 0.0

    # Scores (populated after check-ins)
    overall_score: Optional[float] = None

    # Manager who last actioned this sheet
    reviewed_by: Optional[str] = None
    review_comment: Optional[str] = None

    audit_log: List[AuditLogEntry] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class GoalSheetCreate(GoalSheetBase):
    pass


class GoalSheetStatusUpdate(BaseModel):
    """Used for state transitions (submit, approve, return, lock)."""
    new_status: GoalSheetStatus
    comment: Optional[Annotated[str, Field(max_length=1000)]] = None

    @model_validator(mode="after")
    def comment_required_for_return(self) -> "GoalSheetStatusUpdate":
        if self.new_status == GoalSheetStatus.RETURNED and not self.comment:
            raise ValueError("A comment is required when returning a Goal Sheet.")
        return self


class GoalSheetPublic(GoalSheetBase):
    id: Optional[str] = Field(default=None, alias="_id")
    employee_id: str
    status: GoalSheetStatus
    goal_count: int
    total_weightage: float
    overall_score: Optional[float] = None
    reviewed_by: Optional[str] = None
    review_comment: Optional[str] = None
    audit_log: List[AuditLogEntry] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}
