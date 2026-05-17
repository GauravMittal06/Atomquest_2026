"""
Pydantic models for the User entity.

Role constants must match docs/ROLE_PERMISSIONS.md exactly:
  EMPLOYEE | MANAGER | ADMIN
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Optional

from bson import ObjectId
from pydantic import BaseModel, EmailStr, Field, field_validator


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class PyObjectId(str):
    """Coerce MongoDB ObjectId to str for JSON serialisation (Pydantic v2)."""

    @classmethod
    def __get_pydantic_core_schema__(cls, source_type, handler):
        from pydantic_core import core_schema
        
        return core_schema.json_or_python_schema(
            json_schema=core_schema.str_schema(),
            python_schema=core_schema.union_schema([
                core_schema.is_instance_schema(ObjectId),
                core_schema.chain_schema([
                    core_schema.str_schema(),
                    core_schema.no_info_plain_validator_function(
                        lambda v: v if isinstance(v, (str, ObjectId)) else str(v)
                    ),
                ]),
            ]),
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda v: str(v) if isinstance(v, ObjectId) else v
            ),
        )


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class UserRole(str, Enum):
    """
    Three roles as defined in docs/ROLE_PERMISSIONS.md.
    Changing these names breaks the permission matrix — do not rename.
    """
    EMPLOYEE = "EMPLOYEE"
    MANAGER = "MANAGER"
    ADMIN = "ADMIN"


# ---------------------------------------------------------------------------
# Base / shared fields
# ---------------------------------------------------------------------------

class UserBase(BaseModel):
    employee_id: Annotated[str, Field(min_length=3, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")]
    name: Annotated[str, Field(min_length=2, max_length=100)]
    email: EmailStr
    role: UserRole
    department: Annotated[str, Field(min_length=1, max_length=100)]
    phone: Optional[str] = None
    profile_picture: Optional[str] = None
    # Required when role == EMPLOYEE; must reference a MANAGER user
    manager_id: Optional[str] = None
    is_active: bool = True

    @field_validator("manager_id", mode="before")
    @classmethod
    def manager_id_required_for_employee(cls, v, info):
        # Validation enforced at endpoint level (needs DB lookup) — field accepted here
        return v


# ---------------------------------------------------------------------------
# DB document model (includes MongoDB _id)
# ---------------------------------------------------------------------------

class UserInDB(UserBase):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    hashed_password: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class UserCreate(UserBase):
    password: Annotated[str, Field(min_length=8, max_length=128)]


class UserUpdate(BaseModel):
    """Fields an employee can update about themselves (see ROLE_PERMISSIONS.md)."""
    name: Optional[Annotated[str, Field(min_length=2, max_length=100)]] = None
    phone: Optional[str] = None
    profile_picture: Optional[str] = None


class UserAdminUpdate(UserUpdate):
    """Admin-only updatable fields (all fields except _id, created_at)."""
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
    department: Optional[str] = None
    manager_id: Optional[str] = None
    is_active: Optional[bool] = None


class UserPublic(UserBase):
    """Safe response model — no password hash."""
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    created_at: Optional[datetime] = None
    # Resolved at the API layer for EMPLOYEE users; None for MANAGER / ADMIN.
    reporting_to_name: Optional[str] = None

    model_config = {"populate_by_name": True}


class TokenData(BaseModel):
    user_id: str
    role: UserRole


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"