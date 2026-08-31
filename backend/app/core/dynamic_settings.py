"""In-memory cache of AppSetting overrides, refreshed at startup and after
every admin save. Call sites use eff() instead of reading settings.X
directly wherever a value should be live-tunable from Admin > Settings.

Secret values are decrypted once into this process-memory cache at load
time — the same trust boundary SECRET_KEY/JWT_SECRET already live in for
the app's whole lifetime, not a new class of exposure.
"""
import logging
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt
from app.core.settings_registry import SETTINGS_BY_KEY

logger = logging.getLogger(__name__)

_cache: dict[str, str] = {}


async def load_settings_cache(db: AsyncSession) -> None:
    from app.models.models import AppSetting

    result = await db.execute(select(AppSetting))
    rows = result.scalars().all()
    new_cache: dict[str, str] = {}
    for row in rows:
        if row.value is None:
            continue
        try:
            new_cache[row.key] = decrypt(row.value) if row.is_secret else row.value
        except Exception:
            logger.error("[dynamic-settings] Failed to decrypt %s — skipping override", row.key)
    _cache.clear()
    _cache.update(new_cache)


def eff(key: str, default: Any, cast: Callable = str) -> Any:
    """Effective value for `key`: the admin override if set, else `default`
    (normally the corresponding settings.KEY env value)."""
    raw = _cache.get(key)
    if raw is None or raw == "":
        return default
    if cast is bool:
        return raw.lower() in ("1", "true", "yes", "on")
    try:
        return cast(raw)
    except (TypeError, ValueError):
        return default


def is_set(key: str) -> bool:
    """Whether an override currently exists for a secret key (for the API
    response — never expose the value itself for is_secret keys)."""
    return bool(_cache.get(key))
