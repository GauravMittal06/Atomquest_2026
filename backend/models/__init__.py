from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional

class AdminDashboardMetrics(BaseModel):
    as_of: str
    active_quarter: Optional[str] = None
    employee_submission: Dict[str, Any]
    manager_checkins: Dict[str, Any]
    checkin_summary: Dict[str, Any]
    thrust_area_distribution: List[Dict[str, Any]]
    quarterly_trend: List[Dict[str, Any]]

    class Config:
        from_attributes = True

class EmployeeDashboardMetrics(BaseModel):
    sheet: Optional[Dict[str, Any]] = None
    quarterly_scores: List[Dict[str, Any]] = Field(default_factory=list)
    window_status: Dict[str, Any]
    visible_quarters: List[str] = Field(default_factory=list)

    class Config:
        from_attributes = True

from models.user import (
    UserRole,
    UserBase,
    UserInDB,
    UserCreate,
    UserUpdate,
    UserAdminUpdate,
    UserPublic,
    TokenData,
    Token,
    PyObjectId,
)
from models.goal import (
    ThrustArea,
    UoMType,
    SelfRating,
    SharedGoalRef,
    SharedGoalRequestStatus,
    GoalBase,
    GoalInDB,
    GoalCreate,
    GoalUpdate,
    GoalPublic,
)
from models.goal_sheet import (
    GoalSheetStatus,
    STATUS_BADGE_COLOUR,
    ALLOWED_TRANSITIONS,
    AuditLogEntry,
    GoalSheetBase,
    GoalSheetInDB,
    GoalSheetCreate,
    GoalSheetStatusUpdate,
    GoalSheetPublic,
)
from models.quarter_snapshot import QuarterSnapshot, QuarterSnapshotGoalFrozen
from models.check_in import (
    PeriodLabel,
    CheckInBase,
    CheckInInDB,
    CheckInCreate,
    CheckInUpdate,
    ManagerRemarkUpdate,
    CheckInPublic,
)
from models.checkin_comment import (
    CheckinCommentCreate,
    CheckinCommentInDB,
    CheckinCommentPublic,
)

__all__ = [
    # dashboard
    "AdminDashboardMetrics", "EmployeeDashboardMetrics",
    # user
    "UserRole", "UserBase", "UserInDB", "UserCreate", "UserUpdate",
    "UserAdminUpdate", "UserPublic", "TokenData", "Token", "PyObjectId",
    # goal
    "ThrustArea", "UoMType", "SelfRating", "SharedGoalRef",
    "SharedGoalRequestStatus", "GoalBase", "GoalInDB", "GoalCreate",
    "GoalUpdate", "GoalPublic",
    # goal_sheet
    "GoalSheetStatus", "STATUS_BADGE_COLOUR", "ALLOWED_TRANSITIONS",
    "AuditLogEntry", "GoalSheetBase", "GoalSheetInDB", "GoalSheetCreate",
    "GoalSheetStatusUpdate", "GoalSheetPublic",
    # quarter_snapshot
    "QuarterSnapshot", "QuarterSnapshotGoalFrozen",
    # check_in
    "PeriodLabel", "CheckInBase", "CheckInInDB", "CheckInCreate",
    "CheckInUpdate", "ManagerRemarkUpdate", "CheckInPublic",
    # checkin_comment
    "CheckinCommentCreate", "CheckinCommentInDB", "CheckinCommentPublic",
]