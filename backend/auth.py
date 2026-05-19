"""JWT authentication utilities."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from config import settings
from models.user import TokenData, UserRole

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

# bcrypt silently truncates at 72 UTF-8 bytes; passlib raises ValueError instead.
_BCRYPT_MAX_PASSWORD_BYTES = 72


def _truncate_password_for_bcrypt(plain: str) -> str:
    """Truncate to bcrypt's 72-byte limit at a UTF-8 code-point boundary."""
    encoded = plain.encode("utf-8")
    if len(encoded) <= _BCRYPT_MAX_PASSWORD_BYTES:
        return plain
    truncated = encoded[:_BCRYPT_MAX_PASSWORD_BYTES]
    while truncated:
        try:
            return truncated.decode("utf-8")
        except UnicodeDecodeError:
            truncated = truncated[:-1]
    return ""


def hash_password(plain: str) -> str:
    return pwd_context.hash(_truncate_password_for_bcrypt(plain))


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(_truncate_password_for_bcrypt(plain), hashed)


def create_access_token(user_id: str, role: UserRole, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = {"sub": user_id, "role": role.value, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> TokenData:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id: str = payload.get("sub")
        role_str: str = payload.get("role")
        if user_id is None or role_str is None:
            raise credentials_exception
            
        normalized_role = str(role_str).strip().upper()
        
        return TokenData(user_id=user_id, role=UserRole(normalized_role))
    except (JWTError, ValueError):
        raise credentials_exception


async def get_current_user(token: str = Depends(oauth2_scheme)) -> TokenData:
    return decode_token(token)


def require_roles(*roles: UserRole):
    """Dependency factory: restricts endpoint to given roles."""
    async def _check(token_data: TokenData = Depends(get_current_user)) -> TokenData:
        if token_data.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access requires one of: {[r.value for r in roles]}",
            )
        return token_data
    return _check


# Admin-only guard (docs/ROLE_PERMISSIONS.md §Admin)
require_admin = require_roles(UserRole.ADMIN)
