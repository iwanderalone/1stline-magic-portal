import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class DedupStore:
    def __init__(self, db_path: str = "data/dedup.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS seen_emails (
                    fingerprint TEXT PRIMARY KEY,
                    seen_at     TEXT NOT NULL
                )
            """)
            conn.commit()

    def is_seen(self, fingerprint: str) -> bool:
        with sqlite3.connect(self._path) as conn:
            row = conn.execute(
                "SELECT 1 FROM seen_emails WHERE fingerprint = ?", (fingerprint,)
            ).fetchone()
        return row is not None

    def mark_seen(self, fingerprint: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self._path) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO seen_emails (fingerprint, seen_at) VALUES (?, ?)",
                (fingerprint, now),
            )
            conn.commit()

    def make_fingerprint(self, msg_id: str, mailbox_email: str) -> str:
        raw = f"{mailbox_email}:{msg_id}".encode()
        return hashlib.sha256(raw).hexdigest()[:24]
