"""
System router — cycle status and Admin mock-date controls.

Endpoints:
  GET  /api/system/cycle-status        any authenticated user — current cycle state
  POST /api/system/mock-date           ADMIN — override the system date for demos
  DELETE /api/system/mock-date         ADMIN — clear the override

The mock-date is process-local and not persisted — it exists purely so an
Admin can demonstrate "what happens in July?" without changing the server
clock. See docs/CHECKIN_RULES.md for the calendar this controls.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from auth import get_current_user, require_roles
from models.user import TokenData, UserRole
from services.checkin_window import (
    get_current_cycle_status,
    get_mock_date_override,
    set_mock_date_override,
)

router = APIRouter(prefix="/api/system", tags=["System"])


class MockDatePayload(BaseModel):
    """ISO-formatted date (YYYY-MM-DD) — month value is what drives the cycle."""

    date: date


@router.get("/cycle-status")
async def cycle_status(_: TokenData = Depends(get_current_user)) -> dict:
    """Current cycle state used by the UI to enable/disable check-in inputs."""
    return get_current_cycle_status().to_dict()


@router.post("/mock-date", status_code=status.HTTP_200_OK)
async def set_mock_date(
    body: MockDatePayload,
    _: TokenData = Depends(require_roles(UserRole.ADMIN)),
) -> dict:
    """Admin-only: override the cycle-service "today" for demo purposes."""
    set_mock_date_override(body.date)
    return get_current_cycle_status().to_dict()


@router.delete("/mock-date", status_code=status.HTTP_200_OK)
async def clear_mock_date(
    _: TokenData = Depends(require_roles(UserRole.ADMIN)),
) -> dict:
    """Admin-only: restore the real system clock."""
    set_mock_date_override(None)
    return get_current_cycle_status().to_dict()


@router.get("/mock-date")
async def read_mock_date(_: TokenData = Depends(get_current_user)) -> dict:
    """Inspect the active override (helpful for Admin UI persistence)."""
    override = get_mock_date_override()
    return {"override": override.isoformat() if override else None}
