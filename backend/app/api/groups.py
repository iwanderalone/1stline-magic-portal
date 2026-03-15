"""Group management endpoints (admin)."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import Group, User
from app.schemas.schemas import GroupCreate, GroupUpdate, GroupResponse, GroupMemberUpdate

router = APIRouter(prefix="/groups", tags=["groups"])


def group_to_response(g: Group) -> GroupResponse:
    data = GroupResponse.model_validate(g)
    data.member_ids = [m.id for m in g.members] if g.members else []
    return data


@router.get("/", response_model=list[GroupResponse])
async def list_groups(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Group).options(selectinload(Group.members)).order_by(Group.name)
    )
    return [group_to_response(g) for g in result.scalars().all()]


@router.post("/", response_model=GroupResponse)
async def create_group(
    req: GroupCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    group = Group(**req.model_dump())
    db.add(group)
    await db.flush()
    await db.refresh(group, ["members"])
    return group_to_response(group)


@router.patch("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: UUID, req: GroupUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Group).options(selectinload(Group.members)).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await db.flush()
    return group_to_response(group)


@router.put("/{group_id}/members", response_model=GroupResponse)
async def set_group_members(
    group_id: UUID, req: GroupMemberUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Group).options(selectinload(Group.members)).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404)

    users = await db.execute(select(User).where(User.id.in_(req.user_ids)))
    group.members = list(users.scalars().all())
    await db.flush()
    await db.refresh(group, ["members"])
    return group_to_response(group)


@router.delete("/{group_id}")
async def delete_group(
    group_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404)
    await db.delete(group)
    return {"deleted": True}
