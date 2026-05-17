"""
Pydantic models for the SharedKpi entity.

A SharedKpi is an Admin/Manager-authored KPI that is pushed to multiple
employees simultaneously.  All copies of the goal reference this master
document via shared_goal_ref.link_id.

Rules (docs/SHARED_GOALS.md):
  - Employees can only modify weightage on their copy
  - Goal title and target are read-only for all recipients
  - Achievement syncs automatically from the designated primary_owner
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Any, List, Optional

from pydantic import BaseModel, Field, model_validator

from models.goal import GoalBase, ThrustArea, UoMType


# ---------------------------------------------------------------------------
# Push result — per-recipient outcome
# ---------------------------------------------------------------------------

class PushStatus(str, Enum):
    SUCCESS = "SUCCESS"
    SKIPPED = "SKIPPED"
    ERROR = "ERROR"


class PushRecipientResult(BaseModel):
    employee_id: str
    employee_name: Optional[str] = None
    status: PushStatus
    message: str
    goal_id: Optional[str] = None
    goal_sheet_id: Optional[str] = None


# ---------------------------------------------------------------------------
# SharedKpi — master document stored in `shared_kpis` collection
# ---------------------------------------------------------------------------

class SharedKpiBase(BaseModel):
    period_id: str
    period_label: Annotated[str, Field(min_length=1, max_length=50)]

    # KPI definition — read-only for employees (SHARED_GOALS.md)
    thrust_area: ThrustArea
    description: Annotated[str, Field(min_length=10, max_length=500)]
    uom_type: UoMType
    unit_of_measure: Annotated[str, Field(min_length=1, max_length=50)]
    target_value: Any

    # Default weightage assigned to each recipient copy; they may change it
    default_weightage: Annotated[float, Field(ge=10.0, le=50.0)]

    # The employee whose check-ins are canonical for achievement sync
    primary_owner_id: str

    # All employees who should receive this KPI
    recipient_ids: Annotated[List[str], Field(min_length=1)]

    @model_validator(mode="after")
    def primary_owner_in_recipients(self) -> "SharedKpiBase":
        if self.primary_owner_id not in self.recipient_ids:
            raise ValueError("primary_owner_id must be included in recipient_ids.")
        return self


class SharedKpiInDB(SharedKpiBase):
    id: Optional[str] = Field(default=None, alias="_id")
    link_id: str               # UUID stored in every linked goal copy
    created_by: str            # Admin/Manager user ID
    creator_role: str
    push_results: List[PushRecipientResult] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class SharedKpiPush(SharedKpiBase):
    """Payload for POST /api/shared-kpis/push"""
    pass


class SharedKpiPushResponse(BaseModel):
    link_id: str
    shared_kpi_id: str
    description: str
    push_results: List[PushRecipientResult]
    success_count: int
    skip_count: int
    error_count: int


class SharedKpiPublic(SharedKpiInDB):
    pass
