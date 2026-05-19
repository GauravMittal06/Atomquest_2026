"""
Admin escalation governance endpoints.

POST /api/escalations/run          — manually trigger the escalation engine
GET  /api/escalations              — list escalations by status
PATCH /api/escalations/{escalation_id} — resolve an escalation
"""

from __future__ import annotations

import traceback
from enum import Enum
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from auth import require_roles
from database import get_database
from models.user import TokenData, UserRole
from services.escalation_engine import COLLECTION_ESCALATIONS, run_escalation_engine
from services.mock_time import get_current_date

router = APIRouter(prefix="/api/escalations", tags=["Escalations"])


class StatusFilter(str, Enum):
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    ALL = "ALL"


class ResolveEscalationRequest(BaseModel):
    status: Literal["RESOLVED"]
    resolution_notes: Optional[str] = Field(default=None, max_length=1000)


def _serialize(doc: dict[str, Any]) -> dict[str, Any]:
    if doc and "_id" in doc:
        doc = dict(doc)
        doc["_id"] = str(doc["_id"])
    return doc


@router.post("/run")
async def run_escalations(
    _: TokenData = Depends(require_roles(UserRole.ADMIN)),
) -> dict[str, int]:
    """Manually run the escalation engine (e.g. after changing mock date)."""
    try:
        stats = await run_escalation_engine()
        return stats
    except Exception as e:
        print(f"ESCALATION ENGINE ERROR: {str(e)}")
        print(f"ERROR TYPE: {type(e).__name__}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Escalation engine failed: {str(e)}",
        )


@router.get("")
async def list_escalations(
    status_filter: StatusFilter = Query(
        default=StatusFilter.ACTIVE,
        description="Filter escalations by status",
    ),
    _: TokenData = Depends(require_roles(UserRole.ADMIN)),
) -> list[dict[str, Any]]:
    """Return escalations matching the status filter, newest first."""
    db = get_database()

    query: dict[str, Any] = {}
    if status_filter != StatusFilter.ALL:
        query["status"] = status_filter.value

    cursor = db[COLLECTION_ESCALATIONS].find(query).sort("created_at", -1)
    return [_serialize(doc) async for doc in cursor]


@router.patch("/{escalation_id}")
async def resolve_escalation(
    escalation_id: str,
    body: ResolveEscalationRequest,
    current: TokenData = Depends(require_roles(UserRole.ADMIN)),
) -> dict[str, Any]:
    """Resolve an active escalation with optional notes."""
    if body.status != "RESOLVED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only RESOLVED status is supported.",
        )

    db = get_database()
    doc = await db[COLLECTION_ESCALATIONS].find_one({"escalation_id": escalation_id})
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Escalation not found.",
        )

    if doc.get("status") == "RESOLVED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Escalation is already resolved.",
        )

    now = await get_current_date()
    audit_entry = {
        "action": "RESOLVED",
        "timestamp": now,
        "actor_id": current.user_id,
    }

    await db[COLLECTION_ESCALATIONS].update_one(
        {"escalation_id": escalation_id},
        {
            "$set": {
                "status": "RESOLVED",
                "resolved_at": now,
                "resolution_notes": body.resolution_notes,
            },
            "$push": {"audit_log": audit_entry},
        },
    )

    updated = await db[COLLECTION_ESCALATIONS].find_one({"escalation_id": escalation_id})
    return _serialize(updated)
