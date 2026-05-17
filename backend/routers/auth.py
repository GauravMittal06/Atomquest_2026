"""Auth router: token endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from auth import create_access_token, verify_password
from database import COLLECTION_USERS, get_database
from models.user import Token, UserRole

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/token", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    db = get_database()
    user = await db[COLLECTION_USERS].find_one({"email": form.username})
    if not user or not verify_password(form.password, user.get("hashed_password", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="User account is inactive.")

    token = create_access_token(
        user_id=str(user["_id"]),
        role=UserRole(user["role"]),
    )
    return Token(access_token=token)
