"""User management + profile endpoints."""
import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, get_or_404
from app.core.security import hash_password
from app.models.models import User, Group, UserRole, user_groups
from app.schemas.schemas import (
    UserCreate, UserUpdate, UserResponse, PublicUserResponse,
    AdminResetPassword, ProfileUpdate, AvailabilityPattern,
)
import secrets

router = APIRouter(prefix="/users", tags=["users"])


def user_to_response(u: User) -> UserResponse:
    data = UserResponse.model_validate(u)
    data.group_ids = [g.id for g in u.groups] if u.groups else []
    if u.availability_pattern:
        try:
            data.availability_pattern = AvailabilityPattern(**json.loads(u.availability_pattern))
        except Exception:
            data.availability_pattern = None
    if u.allowed_shift_types:
        try:
            data.allowed_shift_types = json.loads(u.allowed_shift_types)
        except Exception:
            data.allowed_shift_types = None
    return data


def user_to_public(u: User) -> PublicUserResponse:
    data = PublicUserResponse.model_validate(u)
    data.group_ids = [g.id for g in u.groups] if u.groups else []
    return data


@router.get("/", response_model=list[UserResponse] | list[PublicUserResponse])
async def list_users(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).options(selectinload(User.groups)).order_by(User.display_name)
    )
    users = result.scalars().all()
    if user.role == UserRole.ADMIN:
        return [user_to_response(u) for u in users]
    # Engineers get only the fields needed for schedule rendering
    return [user_to_public(u) for u in users]


@router.post("/", response_model=UserResponse)
async def create_user(
    req: UserCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(User).where(User.username == req.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already taken")

    # Load groups before constructing the User object.
    # Setting user.groups on an already-session-attached object triggers a lazy
    # load to compute the old value (for relationship diffing), which is forbidden
    # in async SQLAlchemy (raises MissingGreenlet). Passing groups via the
    # constructor avoids this — no session exists yet, so no load is attempted.
    groups_objs: list = []
    if req.group_ids:
        groups_result = await db.execute(select(Group).where(Group.id.in_(req.group_ids)))
        groups_objs = list(groups_result.scalars().all())

    user = User(
        username=req.username,
        display_name=req.display_name,
        email=req.email,
        hashed_password=hash_password(req.password),
        role=req.role,
        telegram_username=req.telegram_username or None,
        timezone=req.timezone,
        min_shift_gap_days=req.min_shift_gap_days,
        max_shifts_per_week=req.max_shifts_per_week,
        availability_pattern=json.dumps(req.availability_pattern.model_dump()) if req.availability_pattern else None,
        availability_anchor_date=req.availability_anchor_date,
        allowed_shift_types=json.dumps(req.allowed_shift_types) if req.allowed_shift_types is not None else None,
        name_color="#2563eb",
        otp_enabled=False,
        telegram_notify_shifts=True,
        telegram_notify_reminders=True,
        groups=groups_objs,
    )
    db.add(user)
    await db.flush()
    result = await db.execute(
        select(User).options(selectinload(User.groups)).where(User.id == user.id)
    )
    return user_to_response(result.scalar_one())


# ─── Self-service (me) routes come BEFORE /{user_id} routes ─────────────────
# FastAPI matches routes in registration order; static paths must be registered
# before parameterised ones to prevent /me being swallowed by /{user_id}.

@router.get("/me/profile", response_model=UserResponse)
async def get_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).options(selectinload(User.groups)).where(User.id == user.id)
    )
    return user_to_response(result.scalar_one())


@router.patch("/me/profile", response_model=UserResponse)
async def update_profile(
    req: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.flush()
    result = await db.execute(
        select(User).options(selectinload(User.groups)).where(User.id == user.id)
    )
    return user_to_response(result.scalar_one())


@router.post("/me/telegram-link-code")
async def self_telegram_link_code(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    code = secrets.token_hex(4).upper()
    user.telegram_link_code = code
    await db.flush()
    return {"code": code, "instruction": f"Send /link {code} to the bot"}


@router.post("/me/telegram-unlink", response_model=UserResponse)
async def unlink_telegram(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unlink Telegram so the user can link a different account."""
    user.telegram_chat_id = None
    user.telegram_link_code = None
    await db.commit()
    result2 = await db.execute(
        select(User).options(selectinload(User.groups)).where(User.id == user.id)
    )
    return user_to_response(result2.scalar_one())


# ─── Admin routes (parameterised /{user_id}) ────────────────────────────────

@router.post("/{user_id}/reactivate")
async def reactivate_user(
    user_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_or_404(db, User, user_id)
    user.is_active = True
    await db.flush()
    return {"reactivated": True}


@router.delete("/{user_id}/hard")
async def hard_delete_user(
    user_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_or_404(db, User, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    await db.delete(user)
    return {"deleted": True}


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    req: UserUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_or_404(db, User, user_id)
    await db.refresh(user, ["groups"])

    data = req.model_dump(exclude_unset=True)
    group_ids = data.pop("group_ids", None)
    avail = data.pop("availability_pattern", None)
    has_allowed_types = "allowed_shift_types" in data
    allowed_types = data.pop("allowed_shift_types", None)

    for field, value in data.items():
        setattr(user, field, value)

    if avail is not None:
        user.availability_pattern = json.dumps(avail) if avail else None

    if has_allowed_types:
        user.allowed_shift_types = json.dumps(allowed_types) if allowed_types is not None else None

    if group_ids is not None:
        groups = await db.execute(select(Group).where(Group.id.in_(group_ids)))
        user.groups = list(groups.scalars().all())

    await db.flush()
    result = await db.execute(
        select(User).options(selectinload(User.groups)).where(User.id == user.id)
    )
    return user_to_response(result.scalar_one())


@router.delete("/{user_id}")
async def delete_user(
    user_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_or_404(db, User, user_id)
    if str(user.id) == str(admin.id):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user.is_active = False
    await db.flush()
    return {"deleted": True}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: UUID,
    req: AdminResetPassword,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_or_404(db, User, user_id)
    user.hashed_password = hash_password(req.new_password)
    await db.flush()
    return {"ok": True}


@router.post("/{user_id}/telegram-link-code")
async def generate_telegram_link_code(
    user_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_or_404(db, User, user_id)
    code = secrets.token_hex(4).upper()
    user.telegram_link_code = code
    await db.flush()
    return {"code": code, "instruction": f"Send /link {code} to the bot"}


@router.post("/{user_id}/reset-otp")
async def reset_otp(
    user_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin resets OTP for a user (disables 2FA)."""
    user = await get_or_404(db, User, user_id)
    if str(user.id) == str(admin.id):
        raise HTTPException(status_code=400, detail="Use /auth/setup-otp to manage your own OTP")
    user.otp_secret = None
    user.otp_enabled = False
    await db.flush()
    return {"ok": True}
