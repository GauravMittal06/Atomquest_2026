"""
Users router.
Enforces permissions from docs/ROLE_PERMISSIONS.md.
"""

from __future__ import annotations

from datetime import datetime
from typing import List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from auth import get_current_user, hash_password, require_roles, verify_password
from database import COLLECTION_USERS, get_database
from models.user import (
    TokenData,
    UserAdminUpdate,
    UserCreate,
    UserPublic,
    UserRole,
    UserUpdate,
)

router = APIRouter(prefix="/api/users", tags=["Users"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserPublic)
async def get_my_profile(current: TokenData = Depends(get_current_user)):
    db = get_database()
    doc = await db[COLLECTION_USERS].find_one({"_id": ObjectId(current.user_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize(doc)


@router.patch("/me", response_model=UserPublic)
async def update_my_profile(
    body: UserUpdate,
    current: TokenData = Depends(get_current_user),
):
    """Employees and Managers can update their own limited fields."""
    db = get_database()
    update_data = body.model_dump(exclude_none=True)
    update_data["updated_at"] = datetime.utcnow()
    await db[COLLECTION_USERS].update_one(
        {"_id": ObjectId(current.user_id)}, {"$set": update_data}
    )
    doc = await db[COLLECTION_USERS].find_one({"_id": ObjectId(current.user_id)})
    return _serialize(doc)


@router.get("/team", response_model=List[UserPublic])
async def get_team(current: TokenData = Depends(require_roles(UserRole.MANAGER, UserRole.ADMIN))):
    """Manager gets their direct reports; Admin gets all users."""
    db = get_database()
    query = {} if current.role == UserRole.ADMIN else {"manager_id": current.user_id}
    cursor = db[COLLECTION_USERS].find(query, {"hashed_password": 0})
    docs = [_serialize(d) async for d in cursor]
    return docs


@router.get("/{user_id}", response_model=UserPublic)
async def get_user(
    user_id: str,
    current: TokenData = Depends(require_roles(UserRole.MANAGER, UserRole.ADMIN)),
):
    db = get_database()
    doc = await db[COLLECTION_USERS].find_one(
        {"_id": ObjectId(user_id)}, {"hashed_password": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize(doc)


@router.post("/", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    current: TokenData = Depends(require_roles(UserRole.ADMIN)),
):
    """Admin-only: create a new user."""
    db = get_database()

    if await db[COLLECTION_USERS].find_one({"email": body.email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    if await db[COLLECTION_USERS].find_one({"employee_id": body.employee_id}):
        raise HTTPException(status_code=409, detail="Employee ID already exists")

    # Validate manager reference for EMPLOYEE role
    if body.role == UserRole.EMPLOYEE:
        if not body.manager_id:
            raise HTTPException(status_code=422, detail="manager_id is required for EMPLOYEE role")
        manager = await db[COLLECTION_USERS].find_one({"_id": ObjectId(body.manager_id)})
        if not manager or manager.get("role") != UserRole.MANAGER:
            raise HTTPException(status_code=422, detail="manager_id must reference a MANAGER user")

    doc = body.model_dump(exclude={"password"})
    doc["hashed_password"] = hash_password(body.password)
    doc["created_at"] = datetime.utcnow()
    doc["updated_at"] = datetime.utcnow()

    result = await db[COLLECTION_USERS].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc


@router.patch("/{user_id}", response_model=UserPublic)
async def admin_update_user(
    user_id: str,
    body: UserAdminUpdate,
    current: TokenData = Depends(require_roles(UserRole.ADMIN)),
):
    """Admin-only: update any user field (except _id, created_at)."""
    db = get_database()
    update_data = body.model_dump(exclude_none=True)
    update_data["updated_at"] = datetime.utcnow()
    result = await db[COLLECTION_USERS].update_one(
        {"_id": ObjectId(user_id)}, {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    doc = await db[COLLECTION_USERS].find_one(
        {"_id": ObjectId(user_id)}, {"hashed_password": 0}
    )
    return _serialize(doc)
