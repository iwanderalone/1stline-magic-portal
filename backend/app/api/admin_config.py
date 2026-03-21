"""Admin configuration endpoints: shift configs, telegram chats, test notifications."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.deps import require_admin
from app.models.models import User, ShiftConfig, TelegramChat, Notification, ActivityLog, ShiftType, Shift
from app.schemas.schemas import (
    ShiftConfigCreate, ShiftConfigUpdate, ShiftConfigResponse,
    TelegramChatCreate, TelegramChatUpdate, TelegramChatResponse,
    TestNotificationRequest, ActivityLogResponse,
)
from app.services.telegram_service import send_telegram_message, notify_shift_start, notify_office_roster
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


# ─── Test Telegram shift notification ────────────────────

@router.post("/test-telegram-shift")
async def trigger_shift_notification(
    shift_type: str,
    admin: User = Depends(require_admin),
):
    """Manually fire today's shift notification for a given type (day / night / office).
    Always sends even if no shifts are published yet — shows 'no shifts scheduled' in that case.
    Returns how many chats and DMs were reached."""
    mapping = {
        "day": ShiftType.DAY,
        "night": ShiftType.NIGHT,
        "office": None,
    }
    if shift_type not in mapping:
        raise HTTPException(status_code=400, detail="shift_type must be day, night, or office")
    if shift_type == "office":
        await notify_office_roster()
        return {"triggered": shift_type}
    result = await notify_shift_start(mapping[shift_type], force_send=True)
    return {"triggered": shift_type, **result}


# ─── Roster preview ──────────────────────────────────────

@router.get("/telegram-shift-preview")
async def telegram_shift_preview(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return today's/tonight's roster for preview in the admin panel before sending."""
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import and_
    today = datetime.now(timezone.utc).date()
    tomorrow = today + timedelta(days=1)

    async def get_names(shift_type, on_date):
        result = await db.execute(
            select(User).join(Shift, Shift.user_id == User.id).where(
                and_(
                    Shift.date == on_date,
                    Shift.shift_type == shift_type,
                    Shift.is_published == True,
                )
            )
        )
        return [u.display_name for u in result.scalars().all()]

    return {
        "today": today.strftime("%A, %d %b %Y"),
        "tomorrow": tomorrow.strftime("%A, %d %b %Y"),
        "day_today": await get_names(ShiftType.DAY, today),
        "night_today": await get_names(ShiftType.NIGHT, today),
        "day_tomorrow": await get_names(ShiftType.DAY, tomorrow),
        "night_tomorrow": await get_names(ShiftType.NIGHT, tomorrow),
    }


# ─── Telegram diagnostics ────────────────────────────────

@router.get("/telegram-diagnostics")
async def telegram_diagnostics(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Check bot token validity and send a probe message to every configured chat.
    Returns detailed per-chat results so you can see exactly what is failing."""
    import httpx
    from app.core.config import get_settings as _gs
    s = _gs()

    result = {"bot": None, "chats": [], "personal_dms": []}

    # 1. Verify bot token via getMe
    if not s.TELEGRAM_BOT_TOKEN:
        result["bot"] = {"ok": False, "error": "TELEGRAM_BOT_TOKEN is not set in .env"}
        return result

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"https://api.telegram.org/bot{s.TELEGRAM_BOT_TOKEN}/getMe")
            data = r.json()
            if data.get("ok"):
                b = data["result"]
                result["bot"] = {"ok": True, "username": b.get("username"), "name": b.get("first_name")}
            else:
                result["bot"] = {"ok": False, "error": data.get("description", "Unknown error")}
                return result  # No point testing chats if token is bad
    except Exception as e:
        result["bot"] = {"ok": False, "error": str(e)}
        return result

    # 2. Probe each configured chat
    chats_result = await db.execute(select(TelegramChat).where(TelegramChat.is_active == True))
    for chat in chats_result.scalars().all():
        probe_text = f"🔧 Portal diagnostics probe — if you see this, the bot can post to <b>{chat.name}</b>."
        ok = await send_telegram_message(chat.chat_id, probe_text, chat.topic_id)
        result["chats"].append({"name": chat.name, "chat_id": chat.chat_id, "ok": ok})

    # 3. Probe linked personal chats
    users_result = await db.execute(
        select(User).where(User.telegram_chat_id != None, User.is_active == True)
    )
    for user in users_result.scalars().all():
        probe_text = f"🔧 Portal diagnostics probe — DM delivery to <b>{user.display_name}</b> works."
        ok = await send_telegram_message(user.telegram_chat_id, probe_text)
        result["personal_dms"].append({"display_name": user.display_name, "ok": ok})

    return result


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
