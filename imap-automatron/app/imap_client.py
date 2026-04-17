import imaplib
import email as email_lib
import logging
from datetime import date

from app.parser import parse_email

logger = logging.getLogger(__name__)


def fetch_emails(
    email_addr: str,
    password: str,
    imap_server: str,
    imap_port: int,
    monitor_since: date,
) -> list[dict]:
    """Connect to IMAP, search SINCE monitor_since, return parsed email dicts.

    Raises RuntimeError on connection/auth failure so the caller can log and skip.
    """
    mail = None
    try:
        mail = imaplib.IMAP4_SSL(imap_server, imap_port, timeout=30)
        mail.login(email_addr, password)
        mail.select("INBOX", readonly=True)

        since_str = monitor_since.strftime("%d-%b-%Y")
        status, data = mail.search(None, f"(SINCE {since_str})")
        if status != "OK" or not data[0]:
            return []

        results = []
        for num in data[0].split():
            try:
                status, msg_data = mail.fetch(num, "(RFC822)")
                if status != "OK":
                    continue
                msg = email_lib.message_from_bytes(msg_data[0][1])
                results.append(parse_email(msg))
            except Exception as e:
                logger.error(f"[{email_addr}] Error parsing message {num}: {e}")

        return results

    except Exception as e:
        raise RuntimeError(str(e)) from e
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass
