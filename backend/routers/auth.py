"""Auth router: real token + DEV-only mock-login endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field

from auth import create_access_token, verify_password
from config import settings
from database import COLLECTION_USERS, get_database
from models.user import Token, UserRole
from utils import parse_oid

router = APIRouter(prefix="/api/auth", tags=["Auth"])


# ---------------------------------------------------------------------------
# Real login (production path)
# ---------------------------------------------------------------------------

@router.post("/token", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    db = get_database()
    user = await db[COLLECTION_USERS].find_one({"email": form.username.strip().lower()})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    hashed = user.get("hashed_password") or ""
    try:
        password_ok = verify_password(form.password, hashed)
    except Exception:
        password_ok = False
    if not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="User account is inactive.")

    try:
        role = UserRole(user["role"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=500, detail="User misconfigured: invalid role")

    token = create_access_token(
        user_id=str(user["_id"]),
        role=role,
    )
    return Token(access_token=token)


# ---------------------------------------------------------------------------
# DEV-only impersonation
# ---------------------------------------------------------------------------

class MockLoginRequest(BaseModel):
    """
    Payload for the topbar User Impersonation Selector.

    `employee_id` may be either the human-readable seeded identifier
    (e.g. "EMP001", "MGR002", "ADM001") or a MongoDB ObjectId hex string.
    """

    employee_id: str = Field(..., min_length=3, max_length=64)


@router.post("/mock-login", response_model=Token)
async def mock_login(body: MockLoginRequest):
    """
    DEV-only impersonation endpoint.

    Issues a fully-valid signed JWT for the requested seeded user so that the
    Axios interceptor and every `Depends(get_current_user)` guard operate on
    the same authenticated identity. This is what eliminates the 401 desync
    that the old client-only role toggle produced.

    Disabled when `ENABLE_MOCK_LOGIN=false` (set this in production).
    """
    if not settings.enable_mock_login:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Mock login is disabled in this environment.",
        )

    db = get_database()
    user: dict | None = None

    # Accept either a Mongo ObjectId hex or the seeded employee_id (EMP001, …)
    try:
        user = await db[COLLECTION_USERS].find_one({"_id": parse_oid(body.employee_id)})
    except HTTPException:
        user = None

    if not user:
        user = await db[COLLECTION_USERS].find_one({"employee_id": body.employee_id})

    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="User account is inactive.")

    token = create_access_token(
        user_id=str(user["_id"]),
        role=UserRole(user["role"]),
    )
    return Token(access_token=token)
