"""Admin configuration endpoints: shift configs, telegram chats, test notifications."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.deps import require_admin
from app.models.models import User, ShiftConfig, TelegramChat, Notification, ActivityLog
from app.schemas.schemas import (
    ShiftConfigCreate, ShiftConfigUpdate, ShiftConfigResponse,
    TelegramChatCreate, TelegramChatUpdate, TelegramChatResponse,
    TestNotificationRequest, ActivityLogResponse,
)
from app.services.telegram_service import send_telegram_message
from app.services.audit import log_action

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── Shift Configs ───────────────────────────────────────

@router.get("/shift-configs", response_model=list[ShiftConfigResponse])
async def list_shift_configs(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ShiftConfig).order_by(ShiftConfig.shift_type))
    return [ShiftConfigResponse.model_validate(c) for c in result.scalars().all()]


@router.post("/shift-configs", response_model=ShiftConfigResponse)
async def create_shift_config(
    req: ShiftConfigCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(ShiftConfig).where(ShiftConfig.shift_type == req.shift_type)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Config for this shift type already exists")
    config = ShiftConfig(**req.model_dump())
    db.add(config)
    await db.flush()
    result = await db.execute(select(ShiftConfig).where(ShiftConfig.id == config.id))
    return ShiftConfigResponse.model_validate(result.scalar_one())


@router.patch("/shift-configs/{config_id}", response_model=ShiftConfigResponse)
async def update_shift_config(
    config_id: UUID, req: ShiftConfigUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ShiftConfig).where(ShiftConfig.id == config_id))
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    await db.flush()
    return ShiftConfigResponse.model_validate(config)


# ─── Telegram Chats ──────────────────────────────────────

@router.get("/telegram-chats", response_model=list[TelegramChatResponse])
async def list_telegram_chats(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TelegramChat).order_by(TelegramChat.name))
    return [TelegramChatResponse.model_validate(c) for c in result.scalars().all()]


@router.post("/telegram-chats", response_model=TelegramChatResponse)
async def create_telegram_chat(
    req: TelegramChatCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    chat = TelegramChat(**req.model_dump())
    db.add(chat)
    await db.flush()
    result = await db.execute(select(TelegramChat).where(TelegramChat.id == chat.id))
    return TelegramChatResponse.model_validate(result.scalar_one())


@router.patch("/telegram-chats/{chat_db_id}", response_model=TelegramChatResponse)
async def update_telegram_chat(
    chat_db_id: UUID, req: TelegramChatUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TelegramChat).where(TelegramChat.id == chat_db_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(chat, field, value)
    await db.flush()
    return TelegramChatResponse.model_validate(chat)


@router.delete("/telegram-chats/{chat_db_id}")
async def delete_telegram_chat(
    chat_db_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TelegramChat).where(TelegramChat.id == chat_db_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404)
    await db.delete(chat)
    return {"deleted": True}


# ─── Test Notifications ───────────────────────────────────

@router.post("/test-notification")
async def send_test_notification(
    req: TestNotificationRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Send a test in-app (and optionally Telegram) notification to selected users and/or chats."""
    query = select(User).where(User.is_active == True)
    if req.user_ids:
        query = query.where(User.id.in_(req.user_ids))
    result = await db.execute(query)
    users = result.scalars().all()

    sent_in_app = 0
    sent_telegram = 0
    for user in users:
        notif = Notification(
            user_id=user.id,
            title=req.title,
            message=req.message,
        )
        db.add(notif)
        sent_in_app += 1

        if req.send_telegram and user.telegram_chat_id:
            text = f"🔔 <b>{req.title}</b>\n\n{req.message}"
            await send_telegram_message(user.telegram_chat_id, text)
            sent_telegram += 1

    # Send to configured Telegram group chats / channels
    sent_channels = 0
    if req.telegram_chat_db_ids:
        chats_result = await db.execute(
            select(TelegramChat).where(
                TelegramChat.id.in_(req.telegram_chat_db_ids),
                TelegramChat.is_active == True,
            )
        )
        for chat in chats_result.scalars().all():
            text = f"📢 <b>{req.title}</b>\n\n{req.message}"
            if await send_telegram_message(chat.chat_id, text, chat.topic_id):
                sent_channels += 1

    await db.flush()
    details = f"'{req.title}' → {sent_in_app} users"
    if sent_telegram:
        details += f", {sent_telegram} via Telegram"
    if sent_channels:
        details += f", {sent_channels} channels"
    await log_action(db, admin, "test_notification_sent", details)
    return {"sent_in_app": sent_in_app, "sent_telegram": sent_telegram, "sent_channels": sent_channels}


# ─── Audit Logs ───────────────────────────────────────────

@router.get("/audit-logs", response_model=list[ActivityLogResponse])
async def get_audit_logs(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(200)
    )
    return [ActivityLogResponse.model_validate(r) for r in result.scalars().all()]
