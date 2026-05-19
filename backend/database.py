from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import settings

_client: AsyncIOMotorClient | None = None


async def connect_db() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.mongodb_url)
    # Trigger an immediate connection check
    await _client.admin.command("ping")


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        _client = None


def get_database() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("Database client is not initialised. Call connect_db() first.")
    return _client[settings.database_name]


# Collection name constants
COLLECTION_USERS = "users"
COLLECTION_GOAL_SHEETS = "goal_sheets"
COLLECTION_GOALS = "goals"
COLLECTION_CHECKINS = "checkins"
COLLECTION_PERIODS = "appraisal_periods"
COLLECTION_AUDIT_LOG = "audit_log"
COLLECTION_SHARED_KPIS = "shared_kpis"
COLLECTION_CHECKIN_COMMENTS = "checkin_comments"
COLLECTION_SYSTEM = "system"


async def ensure_indexes() -> None:
    """
    Idempotent index setup for dashboard and live-scoring queries.

    Indexes requested: goal_sheet_id (goals), period_label (checkins),
    employee_id (goal_sheets).
    """
    db = get_database()
    await db[COLLECTION_GOALS].create_index("goal_sheet_id")
    await db[COLLECTION_CHECKINS].create_index("period_label")
    await db[COLLECTION_GOAL_SHEETS].create_index("employee_id")
