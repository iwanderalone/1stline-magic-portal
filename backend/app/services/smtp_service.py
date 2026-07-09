"""Outbound SMTP — send replies from monitored mailboxes.

Uses the mailbox's stored (encrypted) IMAP credentials against the configured
SMTP server (Yandex by default; same login works for both protocols). Sync
smtplib is run in a worker thread to stay off the event loop.
"""
import asyncio
import html as html_mod
import logging
import smtplib
from email.message import EmailMessage
from email.utils import parseaddr, formataddr

from app.core.config import get_settings
from app.core.encryption import decrypt
from app.models.models import MailboxConfig

logger = logging.getLogger(__name__)

# Team signature — mirrors the webmail one (logo image omitted: needs a hosted asset).
SIGNATURE_TEXT = (
    "\n\n--\nBest regards,\n\n"
    "IT Support  |  viory.video  |  Telegram: @itsupport_viory"
)
SIGNATURE_HTML = (
    "<br><br>--<br>Best regards,<br><br>"
    "<b>IT Support</b>&nbsp;&nbsp;|&nbsp;&nbsp;"
    '<a href="https://viory.video">viory.video</a>&nbsp;&nbsp;|&nbsp;&nbsp;'
    'Telegram: <a href="https://t.me/itsupport_viory">@itsupport_viory</a>'
)


class SmtpError(Exception):
    """Raised when a reply could not be sent."""


def extract_address(sender: str) -> str:
    """Bare address from a 'Display Name <addr@host>' header value."""
    _, addr = parseaddr(sender or "")
    return addr


def _send_sync(
    host: str, port: int, login: str, password: str,
    to_addr: str, subject: str, body: str, in_reply_to: str | None,
    from_name: str,
) -> None:
    msg = EmailMessage()
    msg["From"] = formataddr((from_name, login))
    msg["To"] = to_addr
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    # Plain + HTML alternative, both carrying the team signature.
    msg.set_content(body + SIGNATURE_TEXT)
    body_html = html_mod.escape(body).replace("\n", "<br>")
    msg.add_alternative(
        f'<div style="font-family:sans-serif;font-size:14px;line-height:1.5">{body_html}{SIGNATURE_HTML}</div>',
        subtype="html",
    )

    # Port 465 = implicit SSL; anything else (587) = STARTTLS.
    # (The VPS provider blocks outbound 465, so 587 is the default.)
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
            smtp.login(login, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls()
            smtp.login(login, password)
            smtp.send_message(msg)


async def send_reply(
    mailbox: MailboxConfig,
    to_addr: str,
    subject: str,
    body: str,
    in_reply_to: str | None = None,
) -> None:
    """Send a reply from `mailbox` to `to_addr`. Raises SmtpError on failure."""
    settings = get_settings()
    if not to_addr or "@" not in to_addr:
        raise SmtpError(f"Invalid recipient address: {to_addr!r}")
    try:
        password = decrypt(mailbox.password)
    except Exception as exc:
        raise SmtpError("Could not decrypt mailbox password") from exc

    try:
        await asyncio.to_thread(
            _send_sync,
            settings.MAIL_SMTP_SERVER, settings.MAIL_SMTP_PORT,
            mailbox.email, password, to_addr, subject, body, in_reply_to,
            settings.MAIL_FROM_NAME,
        )
    except smtplib.SMTPAuthenticationError as exc:
        raise SmtpError(f"SMTP authentication failed for {mailbox.email} — check the mailbox password / app password") from exc
    except (smtplib.SMTPException, OSError) as exc:
        raise SmtpError(f"SMTP send failed: {exc}") from exc

    logger.info("[smtp] reply sent from %s to %s (%r)", mailbox.email, to_addr, subject[:80])
