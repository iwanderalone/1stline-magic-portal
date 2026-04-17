import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def parse_telegram_target(target: str) -> tuple[str, Optional[str]]:
    """Split 'chat_id:thread_id' or 'chat_id' into (chat_id, thread_id | None)."""
    target = target.strip()
    if ":" in target:
        parts = target.split(":", 1)
        chat_id = parts[0].strip()
        thread_id = parts[1].strip() or None
        return chat_id, thread_id
    return target, None


async def send_message(
    token: str,
    chat_id: str,
    text: str,
    thread_id: Optional[str] = None,
) -> bool:
    """Send an HTML message to a Telegram chat. Returns True on success."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if thread_id:
        payload["message_thread_id"] = int(thread_id)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload)
            if not resp.is_success:
                logger.error(f"Telegram send failed: HTTP {resp.status_code} — {resp.text}")
                return False
            return True
    except Exception as e:
        logger.error(f"Telegram send failed: {type(e).__name__}: {e}")
        return False
