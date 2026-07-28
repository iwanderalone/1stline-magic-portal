"""Auth dependencies for protecting routes."""
from typing import Type, TypeVar
from uuid import UUID
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.security import decode_token
from app.models.models import User, UserRole

T = TypeVar("T")

security_scheme = HTTPBearer()

# HR is read-only access to the schedule, plus ordinary self-service (own
# profile, own auth, notification bell) — nothing else. Enforced here, in the
# one dependency almost every route already depends on (directly or via
# require_admin/require_admin_or_manager), so this can't be bypassed by a
# frontend that simply doesn't render the button for a disallowed action.
_HR_ALLOWED_PREFIXES = ("/api/schedule", "/api/users", "/api/auth", "/api/notifications")
_HR_READ_ONLY_PREFIX = "/api/schedule"


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        user_uuid = UUID(user_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    if user.role == UserRole.HR:
        path = request.url.path
        if not any(path.startswith(p) for p in _HR_ALLOWED_PREFIXES):
            raise HTTPException(status_code=403, detail="HR access is limited to the schedule (read-only)")
        if path.startswith(_HR_READ_ONLY_PREFIX) and request.method != "GET":
            raise HTTPException(status_code=403, detail="HR access to the schedule is read-only")

    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


async def require_admin_or_manager(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.ADMIN, UserRole.MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or manager access required",
        )
    return user


async def get_or_404(db: AsyncSession, model: Type[T], obj_id, *, options=None) -> T:
    """Fetch a model instance by primary key or raise HTTP 404."""
    obj = await db.get(model, obj_id, options=options)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return obj

