"""User management endpoints (admin)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.core.security import hash_password
from app.models.models import User
from app.schemas.schemas import UserCreate, UserUpdate, UserResponse
import secrets

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=list[UserResponse])
async def list_users(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.is_active == True).order_by(User.display_name)
    )
    return [UserResponse.model_validate(u) for u in result.scalars().all()]


@router.post("/", response_model=UserResponse)
async def create_user(
    req: UserCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Check uniqueness
    existing = await db.execute(select(User).where(User.username == req.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already taken")

    user = User(
        username=req.username,
        display_name=req.display_name,
        email=req.email,
        hashed_password=hash_password(req.password),
        role=req.role,
        telegram_username=req.telegram_username,
        min_shift_gap_days=req.min_shift_gap_days,
        max_shifts_per_week=req.max_shifts_per_week,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    req: UserUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(user, field, value)

    await db.flush()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/{user_id}/telegram-link-code")
async def generate_telegram_link_code(
    user_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    code = secrets.token_hex(4).upper()
    user.telegram_link_code = code
    await db.flush()
    return {"code": code, "instruction": f"Send /link {code} to the bot"}
