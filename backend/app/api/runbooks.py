"""Runbooks endpoints."""
import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import Runbook, RunbookStep, User
from app.schemas.schemas import RunbookCreate, RunbookUpdate, RunbookResponse
from app.services.audit import log_action

router = APIRouter(prefix="/runbooks", tags=["runbooks"])


async def _next_slug(db: AsyncSession) -> str:
    result = await db.execute(select(func.count()).select_from(Runbook))
    count = result.scalar_one()
    return f"rb-{count + 1:03d}"


def _serialize_tags(tags: list[str] | None) -> str | None:
    if tags is None:
        return None
    return json.dumps(tags)


async def _replace_steps(db: AsyncSession, runbook: Runbook, steps_data: list) -> None:
    for step in list(runbook.steps):
        await db.delete(step)
    await db.flush()
    for s in steps_data:
        db.add(RunbookStep(
            runbook_id=runbook.id,
            order=s.order,
            title=s.title,
            description=s.description,
            code_block=s.code_block,
            code_language=s.code_language,
        ))


@router.get("/", response_model=list[RunbookResponse])
async def list_runbooks(
    category: str | None = Query(default=None),
    search: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    q = select(Runbook).options(
        selectinload(Runbook.steps),
        selectinload(Runbook.owner),
    ).order_by(Runbook.slug)

    if category:
        q = q.where(Runbook.category == category)
    if search:
        term = f"%{search.lower()}%"
        q = q.where(
            func.lower(Runbook.title).like(term)
            | func.lower(Runbook.when_to_use).like(term)
        )

    result = await db.execute(q)
    return [RunbookResponse.model_validate(r) for r in result.scalars().all()]


@router.get("/categories")
async def list_categories(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Runbook.category, func.count().label("count"))
        .group_by(Runbook.category)
        .order_by(Runbook.category)
    )
    rows = result.all()
    total_result = await db.execute(select(func.count()).select_from(Runbook))
    total = total_result.scalar_one()
    return {
        "total": total,
        "categories": [{"name": r.category, "count": r.count} for r in rows],
    }


@router.get("/{runbook_id}", response_model=RunbookResponse)
async def get_runbook(
    runbook_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Runbook)
        .options(selectinload(Runbook.steps), selectinload(Runbook.owner))
        .where(Runbook.id == runbook_id)
    )
    rb = result.scalar_one_or_none()
    if not rb:
        raise HTTPException(status_code=404)
    return RunbookResponse.model_validate(rb)


@router.post("/", response_model=RunbookResponse)
async def create_runbook(
    req: RunbookCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    slug = await _next_slug(db)
    rb = Runbook(
        slug=slug,
        title=req.title,
        category=req.category,
        tags=_serialize_tags(req.tags),
        when_to_use=req.when_to_use,
        owner_id=req.owner_id,
    )
    db.add(rb)
    await db.flush()
    for s in req.steps:
        db.add(RunbookStep(
            runbook_id=rb.id,
            order=s.order,
            title=s.title,
            description=s.description,
            code_block=s.code_block,
            code_language=s.code_language,
        ))
    await db.flush()

    result = await db.execute(
        select(Runbook)
        .options(selectinload(Runbook.steps), selectinload(Runbook.owner))
        .where(Runbook.id == rb.id)
    )
    created = result.scalar_one()
    await log_action(db, user, "runbook_create", f"Created runbook: {created.slug} — {created.title}")
    return RunbookResponse.model_validate(created)


@router.put("/{runbook_id}", response_model=RunbookResponse)
async def update_runbook(
    runbook_id: UUID,
    req: RunbookUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Runbook)
        .options(selectinload(Runbook.steps), selectinload(Runbook.owner))
        .where(Runbook.id == runbook_id)
    )
    rb = result.scalar_one_or_none()
    if not rb:
        raise HTTPException(status_code=404)

    if req.title is not None:
        rb.title = req.title
    if req.category is not None:
        rb.category = req.category
    if req.tags is not None:
        rb.tags = _serialize_tags(req.tags)
    if req.when_to_use is not None:
        rb.when_to_use = req.when_to_use
    if "owner_id" in req.model_fields_set:
        rb.owner_id = req.owner_id
    if req.steps is not None:
        await _replace_steps(db, rb, req.steps)

    await db.flush()
    result2 = await db.execute(
        select(Runbook)
        .options(selectinload(Runbook.steps), selectinload(Runbook.owner))
        .where(Runbook.id == runbook_id)
    )
    updated = result2.scalar_one()
    await log_action(db, user, "runbook_update", f"Updated runbook: {updated.slug} — {updated.title}")
    return RunbookResponse.model_validate(updated)


@router.delete("/{runbook_id}")
async def delete_runbook(
    runbook_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rb = await db.get(Runbook, runbook_id)
    if not rb:
        raise HTTPException(status_code=404)
    await db.delete(rb)
    return {"deleted": True}


@router.post("/{runbook_id}/run")
async def record_run(
    runbook_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rb = await db.get(Runbook, runbook_id)
    if not rb:
        raise HTTPException(status_code=404)
    rb.run_count = (rb.run_count or 0) + 1
    await db.flush()
    return {"run_count": rb.run_count}
