import asyncio
import logging
import signal

from app.classifier import classify
from app.config import get_settings
from app.config_loader import MailboxConfig, RoutingRule, load_config
from app.dedup import DedupStore
from app.formatter import format_message
from app.imap_client import fetch_emails
from app.telegram import parse_telegram_target, send_message

logger = logging.getLogger(__name__)


async def check_mailbox(mb: MailboxConfig, dedup: DedupStore, settings) -> None:
    logger.info(f"[{mb.email}] Polling since {mb.monitor_since}")

    try:
        emails = await asyncio.to_thread(
            fetch_emails, mb.email, mb.password, mb.imap_server, mb.imap_port, mb.monitor_since
        )
    except RuntimeError as e:
        logger.error(f"[{mb.email}] IMAP failed: {e}")
        return

    sent = skipped_dedup = skipped_filter = 0

    for email in emails:
        fingerprint = dedup.make_fingerprint(email["msg_id"], mb.email)

        if dedup.is_seen(fingerprint):
            skipped_dedup += 1
            continue

        if mb.subject_filter and mb.subject_filter.lower() not in email["subject"].lower():
            logger.debug(f"[{mb.email}] Filtered: {email['subject']!r}")
            dedup.mark_seen(fingerprint)
            skipped_filter += 1
            continue

        matched = classify(email["sender"], email["subject"], email["body"], mb.rules)
        if matched is None:
            if mb.catch_all is None:
                logger.warning(
                    f"[{mb.email}] No rule and no catch_all for: {email['subject']!r} — skipping"
                )
                dedup.mark_seen(fingerprint)
                continue
            matched = mb.catch_all

        target = (
            matched.telegram_target
            if isinstance(matched, RoutingRule) and matched.telegram_target
            else mb.default_telegram_target
        )
        chat_id, thread_id = parse_telegram_target(target)

        if not chat_id:
            logger.warning(f"[{mb.email}] No Telegram target for: {email['subject']!r}")
            dedup.mark_seen(fingerprint)
            continue

        message = format_message(email, matched, mb.email, settings.TIMEZONE)
        ok = await send_message(settings.TELEGRAM_BOT_TOKEN, chat_id, message, thread_id)

        if ok:
            dedup.mark_seen(fingerprint)
            rule_name = matched.name if isinstance(matched, RoutingRule) else "catch_all"
            logger.info(f"[{mb.email}] Sent [{rule_name}]: {email['subject']!r} → {target}")
            sent += 1
        else:
            logger.warning(f"[{mb.email}] Send failed, will retry next poll: {email['subject']!r}")

    logger.info(
        f"[{mb.email}] Done — {len(emails)} fetched, {sent} sent, "
        f"{skipped_dedup} dedup, {skipped_filter} filtered"
    )


async def run() -> None:
    settings = get_settings()

    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    )

    try:
        mailboxes = load_config(settings.CONFIG_PATH)
    except (ValueError, FileNotFoundError) as e:
        logger.critical(f"Config error: {e}")
        raise SystemExit(1)

    dedup = DedupStore()
    logger.info(
        f"imap-automatron started — {len(mailboxes)} mailbox(es), "
        f"polling every {settings.POLL_INTERVAL}s"
    )

    stop = asyncio.Event()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    while not stop.is_set():
        for mb in mailboxes:
            try:
                await check_mailbox(mb, dedup, settings)
            except Exception as e:
                logger.error(f"[{mb.email}] Unhandled error: {e}")

        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.POLL_INTERVAL)
        except asyncio.TimeoutError:
            pass

    logger.info("imap-automatron stopped")


if __name__ == "__main__":
    asyncio.run(run())
