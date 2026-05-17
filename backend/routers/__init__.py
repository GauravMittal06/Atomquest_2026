from routers.auth import router as auth_router
from routers.users import router as users_router
from routers.goal_sheets import router as goal_sheets_router
from routers.goals import router as goals_router
from routers.checkins import router as checkins_router
from routers.checkin_comments import router as checkin_comments_router
from routers.shared_kpis import router as shared_kpis_router
from routers.system import router as system_router

__all__ = [
    "auth_router",
    "users_router",
    "goal_sheets_router",
    "goals_router",
    "checkins_router",
    "checkin_comments_router",
    "shared_kpis_router",
    "system_router",
]
