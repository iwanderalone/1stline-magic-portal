"""Admin-editable runtime settings — overrides for app/core/config.py env
defaults, stored in AppSetting and resolved live via dynamic_settings.eff().
Admin-only: these are infra-sensitive (integration tokens, session policy).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_admin
from app.core.encryption import encrypt
from app.core.config import get_settings
from app.core.dynamic_settings import load_settings_cache, is_set
from app.core.scheduler import scheduler
from app.core.settings_registry import SETTINGS_REGISTRY, SETTINGS_BY_KEY
from app.models.models import User, AppSetting
from app.schemas.schemas import SettingFieldResponse, SettingsUpdate
from app.services.audit import log_action

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])


@router.get("", response_model=list[SettingFieldResponse])
async def list_settings(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    settings = get_settings()
    result = await db.execute(select(AppSetting))
    overrides = {row.key: row for row in result.scalars().all()}

    out = []
    for field in SETTINGS_REGISTRY:
        key = field["key"]
        row = overrides.get(key)
        if field.get("is_secret"):
            out.append(SettingFieldResponse(
                key=key, category=field["category"], label=field["label"],
                type=field["type"], is_secret=True,
                requires_restart=field.get("requires_restart", False),
                is_set=bool(row and row.value),
            ))
        else:
            effective = row.value if (row and row.value not in (None, "")) else str(getattr(settings, key, ""))
            out.append(SettingFieldResponse(
                key=key, category=field["category"], label=field["label"],
                type=field["type"], is_secret=False,
                requires_restart=field.get("requires_restart", False),
                value=effective,
            ))
    return out


@router.patch("", response_model=list[SettingFieldResponse])
async def update_settings(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    unknown = [k for k in body.values if k not in SETTINGS_BY_KEY]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown setting(s): {', '.join(unknown)}")

    result = await db.execute(select(AppSetting).where(AppSetting.key.in_(body.values.keys())))
    existing = {row.key: row for row in result.scalars().all()}

    changed = []
    for key, value in body.values.items():
        field = SETTINGS_BY_KEY[key]
        row = existing.get(key)
        if not row:
            row = AppSetting(key=key, is_secret=field.get("is_secret", False))
            db.add(row)

        # Empty string clears the override (falls back to env default).
        stored_value = None if value in (None, "") else value
        if field.get("is_secret") and stored_value is not None:
            stored_value = encrypt(stored_value)

        row.value = stored_value
        row.updated_by = admin.username
        changed.append(key)

    await db.flush()
    await log_action(db, admin, "settings_update", f"Updated: {', '.join(changed)}")
    await db.commit()

    await load_settings_cache(db)

    if "MAIL_POLL_INTERVAL" in changed:
        settings = get_settings()
        from app.core.dynamic_settings import eff
        interval = eff("MAIL_POLL_INTERVAL", settings.MAIL_POLL_INTERVAL, cast=int)
        try:
            scheduler.reschedule_job("mail_reporter_poll", trigger="interval", seconds=interval)
        except Exception:
            pass  # job may not exist yet in this process (e.g. fresh dev DB) — next restart picks it up

    return await list_settings(db=db, _admin=admin)
