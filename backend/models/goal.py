"""
Pydantic models for Goal entity.

Validation rules are sourced from docs/VALIDATION_RULES.md:
  - Thrust Area enum (8 values)
  - UoM Type: QUANTITATIVE | QUALITATIVE
  - Target: positive number (quantitative) or text (qualitative)
  - Weightage: 5 % – 50 %; sheet total must equal 100 %
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Enums — kept in sync with VALIDATION_RULES.md §1 and §2
# ---------------------------------------------------------------------------

class ThrustArea(str, Enum):
    INNOVATION_TECHNOLOGY = "INNOVATION_TECHNOLOGY"
    QUALITY_PROCESS_EXCELLENCE = "QUALITY_PROCESS_EXCELLENCE"
    CUSTOMER_SATISFACTION = "CUSTOMER_SATISFACTION"
    DELIVERY_TIMELINESS = "DELIVERY_TIMELINESS"
    PEOPLE_DEVELOPMENT = "PEOPLE_DEVELOPMENT"
    BUSINESS_GROWTH = "BUSINESS_GROWTH"
    SAFETY_COMPLIANCE = "SAFETY_COMPLIANCE"
    COST_OPTIMISATION = "COST_OPTIMISATION"


class UoMType(str, Enum):
    NUMERIC = "Numeric"
    TIMELINE = "Timeline"
    ZERO = "Zero"


class SelfRating(float, Enum):
    """
    Qualitative self-rating scale (VALIDATION_RULES.md §2b).
    Maps to factor: value / 5.
    """
    ZERO = 0.0
    ONE = 1.0
    TWO = 2.0
    THREE = 3.0
    FOUR = 4.0
    FIVE = 5.0


# ---------------------------------------------------------------------------
# Shared goal reference (docs/SHARED_GOALS.md)
# ---------------------------------------------------------------------------

class SharedGoalRequestStatus(str, Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"


class SharedGoalRef(BaseModel):
    is_shared: bool = False
    originator_id: Optional[str] = None
    partner_id: Optional[str] = None
    request_status: Optional[SharedGoalRequestStatus] = None
    link_id: Optional[str] = None  # Common UUID linking both goal copies


# ---------------------------------------------------------------------------
# Goal base model
# ---------------------------------------------------------------------------

class GoalBase(BaseModel):
    thrust_area: ThrustArea
    description: Annotated[str, Field(min_length=10, max_length=500)]
    uom_type: UoMType
    unit_of_measure: Annotated[str, Field(min_length=1, max_length=50)]

    # target_value is a union: positive float for QUANTITATIVE, text for QUALITATIVE
    # Serialised as Any; validated by the cross-field validator below
    target_value: Any

    # Weightage: 10 % – 50 % (VALIDATION_RULES.md)
    weightage: Annotated[float, Field(ge=10.0, le=50.0)]

    shared_goal_ref: SharedGoalRef = Field(default_factory=SharedGoalRef)

    @model_validator(mode="after")
    def validate_target_by_uom_type(self) -> "GoalBase":
        if self.uom_type == UoMType.NUMERIC:
            # Numeric: target must be a positive finite number
            try:
                val = float(self.target_value)
            except (TypeError, ValueError):
                raise ValueError("target_value must be a positive number for Numeric goals")
            if val <= 0:
                raise ValueError("target_value must be > 0 for Numeric goals")
            self.target_value = round(val, 4)

        elif self.uom_type == UoMType.TIMELINE:
            # Timeline: target must be a non-empty date or description string
            val = str(self.target_value).strip()
            if not val:
                raise ValueError("target_value must be a non-empty date or description for Timeline goals")
            if len(val) > 500:
                raise ValueError("target_value must not exceed 500 characters for Timeline goals")
            self.target_value = val

        else:
            # Zero: binary outcome — value must be 'Yes' or 'No'
            val = str(self.target_value).strip()
            if val not in ("Yes", "No"):
                raise ValueError("target_value must be 'Yes' or 'No' for Zero goals")
            self.target_value = val

        return self


# ---------------------------------------------------------------------------
# DB document model
# ---------------------------------------------------------------------------

class GoalInDB(GoalBase):
    id: Optional[str] = Field(default=None, alias="_id")
    goal_sheet_id: str  # Reference to parent GoalSheet
    owner_id: str       # Reference to User

    # Computed at check-in time
    latest_actual_value: Optional[Any] = None
    achievement_pct: Optional[float] = None
    goal_score: Optional[float] = None

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class GoalCreate(GoalBase):
    pass


class GoalUpdate(BaseModel):
    """Allowed only when parent GoalSheet is DRAFT or RETURNED."""
    thrust_area: Optional[ThrustArea] = None
    description: Optional[Annotated[str, Field(min_length=10, max_length=500)]] = None
    uom_type: Optional[UoMType] = None
    unit_of_measure: Optional[str] = None
    target_value: Optional[Any] = None
    weightage: Optional[Annotated[float, Field(ge=10.0, le=50.0)]] = None

    @model_validator(mode="after")
    def validate_target_if_uom_provided(self) -> "GoalUpdate":
        if self.uom_type and self.target_value is not None:
            if self.uom_type == UoMType.NUMERIC:
                try:
                    val = float(self.target_value)
                except (TypeError, ValueError):
                    raise ValueError("target_value must be numeric for Numeric goals")
                if val <= 0:
                    raise ValueError("target_value must be > 0 for Numeric goals")
            elif self.uom_type == UoMType.ZERO:
                if str(self.target_value).strip() not in ("Yes", "No"):
                    raise ValueError("target_value must be 'Yes' or 'No' for Zero goals")
        return self


class GoalPublic(GoalBase):
    id: Optional[str] = Field(default=None, alias="_id")
    goal_sheet_id: str
    owner_id: str
    latest_actual_value: Optional[Any] = None
    achievement_pct: Optional[float] = None
    goal_score: Optional[float] = None

    model_config = {"populate_by_name": True}
