"""
Centralized time source for the entire backend.

Provides a mockable time service that allows Admin users to override the system
date for testing and demo purposes. The mock date is persisted to MongoDB so it
survives server restarts.

All date-sensitive code (escalation engine, check-in windows, etc.) MUST use
:func:`get_current_date` instead of ``datetime.now()`` to respect Admin overrides.

MongoDB Schema:
    Collection: "system"
    Document: {
        "_id": "mock_date",
        "value": ISODate("2026-07-15T00:00:00Z")  # Optional datetime field
    }
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from database import get_database

COLLECTION_SYSTEM = "system"
MOCK_DATE_KEY = "mock_date"


async def get_current_date() -> datetime:
    """
    Return the current system datetime, respecting Admin mock overrides.

    This function MUST be used by all date-sensitive code instead of
    ``datetime.now(timezone.utc)`` to ensure mock dates are respected during
    testing and demonstrations.

    Returns:
        datetime: The mocked date (if set) or the real system time (UTC).

    Example:
        >>> # In escalation engine
        >>> now = await get_current_date()
        >>> if (now - last_checkin).days > 30:
        >>>     escalate()
    """
    db = get_database()
    system_doc = await db[COLLECTION_SYSTEM].find_one({"_id": MOCK_DATE_KEY})
    
    if system_doc and "value" in system_doc:
        mock_date = system_doc["value"]
        # Ensure the datetime is timezone-aware (UTC)
        if mock_date.tzinfo is None:
            mock_date = mock_date.replace(tzinfo=timezone.utc)
        return mock_date
    
    return datetime.now(timezone.utc)


async def set_mock_date(date: Optional[datetime]) -> None:
    """
    Set or clear the Admin mock date override.

    Args:
        date: The datetime to use as "now" throughout the system, or ``None``
              to clear the override and restore the real system clock.

    Note:
        This operation requires Admin privileges. The caller (typically
        ``routers/system.py``) is responsible for authorization checks.

    Example:
        >>> # Admin sets date to July 2026 for demo
        >>> from datetime import datetime, timezone
        >>> await set_mock_date(datetime(2026, 7, 15, tzinfo=timezone.utc))
        >>>
        >>> # Clear the override
        >>> await set_mock_date(None)
    """
    db = get_database()
    
    if date is None:
        # Clear the mock date override
        await db[COLLECTION_SYSTEM].delete_one({"_id": MOCK_DATE_KEY})
    else:
        # Ensure the datetime is timezone-aware (UTC)
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        
        # Upsert the mock date
        await db[COLLECTION_SYSTEM].update_one(
            {"_id": MOCK_DATE_KEY},
            {"$set": {"value": date}},
            upsert=True,
        )


async def get_mock_date() -> Optional[datetime]:
    """
    Retrieve the current mock date override (if any).

    This is useful for Admin UI to display the current override state.

    Returns:
        datetime or None: The mocked datetime if set, otherwise ``None``.
    """
    db = get_database()
    system_doc = await db[COLLECTION_SYSTEM].find_one({"_id": MOCK_DATE_KEY})
    
    if system_doc and "value" in system_doc:
        mock_date = system_doc["value"]
        # Ensure the datetime is timezone-aware (UTC)
        if mock_date.tzinfo is None:
            mock_date = mock_date.replace(tzinfo=timezone.utc)
        return mock_date
    
    return None
