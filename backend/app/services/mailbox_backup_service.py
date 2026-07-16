"""Mailbox Backup tool — IMAP pull of a Yandex mailbox → .tar.zst → S3.

Ported from the standalone mailbox-decom script (decommission_mailbox.py).
Pipeline: IMAP fetch (Maildir layout) → tar.zst archive → SHA-256 → upload to
S3-compatible storage → HEAD-verify size → optional per-folder .mbox export →
local cleanup. The mailbox password lives in memory for the duration of the
job and is never persisted.

The blocking pipeline runs in a worker thread (asyncio.to_thread). Live
progress is kept in the in-memory JOBS registry; the DB row is written when
the job starts and when it finishes. Jobs do not survive an app restart —
`fail_stale_jobs()` marks orphans on startup.
"""
from __future__ import annotations

import asyncio
import base64
import datetime as dt
import hashlib
import imaplib
import logging
import mailbox
import re
import shutil
import socket
import tarfile
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from app.core.config import get_settings
from app.core.database import AsyncSessionFactory
from app.models.models import MailboxBackupJob, utcnow

logger = logging.getLogger(__name__)

IMAP_TIMEOUT = 120
# Yandex drops long IMAP sessions — reconnect and resume; give up only after
# this many consecutive drops with no fetched message in between.
MAX_DROPS_WITHOUT_PROGRESS = 3
# Some hangs (e.g. a DNS lookup that never returns) happen below imaplib's own
# socket timeout and never raise at all. If the job reports zero progress for
# this long, give up waiting on it rather than let it — and the serialized
# job queue behind it — block forever.
STALL_TIMEOUT_SEC = 360
_FS_INVALID = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def enabled() -> bool:
    s = get_settings()
    return bool(s.S3_BUCKET and s.S3_ACCESS_KEY_ID and s.S3_SECRET_ACCESS_KEY)


# ─── live progress registry ──────────────────────────────────────────

@dataclass
class JobProgress:
    phase: str = "queued"
    folders_total: int = 0
    folders_done: int = 0
    messages_total: int = 0
    messages_done: int = 0
    current_folder: str = ""
    updated_at: float = field(default_factory=time.time)

    def touch(self):
        self.updated_at = time.time()


JOBS: dict[int, JobProgress] = {}       # job_id → live progress (this process only)
_CANCELS: dict[int, threading.Event] = {}  # job_id → cancel flag (set from the API, read in the worker thread)
_RUNNING_EMAILS: set[str] = set()       # concurrency guard
_GLOBAL_LOCK: asyncio.Lock = asyncio.Lock()  # one pipeline at a time — batch jobs run sequentially


class BackupCancelled(Exception):
    """Raised inside the pipeline when the job's cancel flag is set."""


def is_email_busy(email: str) -> bool:
    return email.lower() in _RUNNING_EMAILS


def request_cancel(job_id: int) -> bool:
    """Flag a live job for cancellation. Returns False if the job is not
    tracked by this process (e.g. orphaned by a restart)."""
    if job_id not in JOBS:
        return False
    _CANCELS.setdefault(job_id, threading.Event()).set()
    return True


def _check_cancel(cancel: threading.Event):
    if cancel.is_set():
        raise BackupCancelled()


# ─── modified UTF-7 (RFC 3501) folder names ──────────────────────────

def imap_utf7_decode(b: bytes) -> str:
    if isinstance(b, str):
        b = b.encode("ascii", errors="replace")
    result: list[str] = []
    i = 0
    while i < len(b):
        c = b[i]
        if c == ord("&"):
            j = b.find(b"-", i + 1)
            if j == -1:
                raise ValueError("invalid modified UTF-7: missing '-'")
            if j == i + 1:
                result.append("&")
            else:
                encoded = b[i + 1:j].replace(b",", b"/")
                encoded += b"=" * ((-len(encoded)) % 4)
                result.append(base64.b64decode(encoded).decode("utf-16-be"))
            i = j + 1
        else:
            result.append(chr(c))
            i += 1
    return "".join(result)


def _sanitize_filename(name: str) -> str:
    safe = _FS_INVALID.sub("_", name).strip(" .")
    return safe or "_"


def _parse_list_response(lines) -> list[bytes]:
    folders: list[bytes] = []
    pat = re.compile(rb'^\([^)]*\)\s+(?:NIL|"[^"]*")\s+(?:"((?:[^"\\]|\\.)*)"|(\S.*))\s*$')
    for line in lines or []:
        if not line:
            continue
        if isinstance(line, tuple) and len(line) >= 2:
            head, literal = line[0], line[1]
            if isinstance(head, bytes) and isinstance(literal, bytes):
                escaped = literal.replace(b"\\", b"\\\\").replace(b'"', b'\\"')
                line = re.sub(rb"\{\d+\}\s*$", b'"' + escaped + b'"', head)
        if not isinstance(line, bytes):
            continue
        m = pat.match(line)
        if not m:
            continue
        name = m.group(1) if m.group(1) is not None else m.group(2)
        folders.append(name.replace(b'\\"', b'"').replace(b"\\\\", b"\\"))
    return folders


def _imap_quote(value: bytes) -> bytes:
    return b'"' + value.replace(b"\\", b"\\\\").replace(b'"', b'\\"') + b'"'


# ─── blocking pipeline (runs in a worker thread) ─────────────────────

def _imap_pull(email_addr: str, password: str, maildir: Path, prog: JobProgress,
               cancel: threading.Event) -> int:
    """Fetch every message from every folder into a Maildir layout."""
    s = get_settings()

    def _connect() -> imaplib.IMAP4_SSL:
        conn = imaplib.IMAP4_SSL(s.MAILBOX_BACKUP_IMAP_HOST, 993, timeout=IMAP_TIMEOUT)
        try:
            conn.login(email_addr, password)
        except imaplib.IMAP4.error as e:
            raise RuntimeError(f"IMAP login failed — check the address and app password ({e})") from e
        return conn

    def _connect_with_retry() -> imaplib.IMAP4_SSL:
        """The very first connect used to be a single unguarded attempt — if it
        hung or dropped, the whole job (and the serialized queue behind it)
        died silently with no retry. Give it the same bounded retry+backoff
        as mid-fetch reconnects."""
        last_err: Exception = RuntimeError("no attempt made")
        for attempt in range(1, MAX_DROPS_WITHOUT_PROGRESS + 2):
            _check_cancel(cancel)
            try:
                return _connect()
            except (imaplib.IMAP4.abort, OSError) as e:
                last_err = e
                logger.warning("[mbbackup] initial IMAP connect failed (%s) — retry %d/%d",
                               e, attempt, MAX_DROPS_WITHOUT_PROGRESS + 1)
                prog.touch()
                for _ in range(min(30, 5 * attempt)):
                    _check_cancel(cancel)
                    time.sleep(1)
        raise RuntimeError(f"could not establish an IMAP connection after "
                           f"{MAX_DROPS_WITHOUT_PROGRESS + 1} attempts (last error: {last_err})")

    prog.phase = "connecting"
    prog.touch()
    imap = _connect_with_retry()
    drops = 0  # consecutive connection drops with no progress in between
    try:
        prog.phase = "listing"
        prog.touch()
        typ, list_raw = imap.list()
        if typ != "OK":
            raise RuntimeError(f"IMAP LIST failed: {typ}")
        folders_encoded = _parse_list_response(list_raw)

        # First pass: count messages per folder so the progress bar has a total.
        folder_infos: list[tuple[bytes, str, int]] = []
        for folder_bytes in folders_encoded:
            _check_cancel(cancel)
            prog.touch()
            try:
                display = imap_utf7_decode(folder_bytes)
            except Exception:
                display = folder_bytes.decode("latin-1", errors="replace")
            sel_typ, sel_data = imap.select(_imap_quote(folder_bytes), readonly=True)
            if sel_typ != "OK":
                logger.warning("[mbbackup] SELECT failed for %r — skipping", display)
                continue
            try:
                count = int(sel_data[0])
            except (TypeError, ValueError, IndexError):
                count = 0
            folder_infos.append((folder_bytes, display, count))

        prog.folders_total = len(folder_infos)
        prog.messages_total = sum(c for _, _, c in folder_infos)
        prog.phase = "fetching"
        prog.touch()

        maildir.mkdir(parents=True, exist_ok=True)
        hostname = _sanitize_filename(socket.gethostname() or "host")
        total = 0

        for folder_bytes, display, count in folder_infos:
            _check_cancel(cancel)
            prog.current_folder = display
            prog.touch()

            folder_path = maildir / _sanitize_filename(display)
            uids: Optional[list[bytes]] = None
            next_idx = 0  # resume point within the folder after a reconnect

            while True:  # retry loop: reconnect + resume on connection drops
                _check_cancel(cancel)
                try:
                    sel_typ, _ = imap.select(_imap_quote(folder_bytes), readonly=True)
                    if sel_typ != "OK":
                        logger.warning("[mbbackup] SELECT failed for %r — skipping", display)
                        break
                    if uids is None:
                        search_typ, search_data = imap.uid("search", None, "ALL")
                        if search_typ != "OK" or not search_data or not search_data[0]:
                            break
                        uids = search_data[0].split()
                        for sub in ("new", "cur", "tmp"):
                            (folder_path / sub).mkdir(parents=True, exist_ok=True)

                    while next_idx < len(uids):
                        _check_cancel(cancel)
                        uid = uids[next_idx]
                        seq = next_idx + 1
                        fetch_typ, fetched = imap.uid("fetch", uid, "(RFC822)")
                        next_idx += 1
                        drops = 0  # fetched something since the last drop
                        if fetch_typ != "OK":
                            continue
                        body: Optional[bytes] = None
                        for piece in fetched:
                            if isinstance(piece, tuple) and len(piece) >= 2 and piece[1]:
                                body = piece[1]
                                break
                        if not body:
                            continue
                        ts_us = int(time.time() * 1_000_000)
                        uid_str = uid.decode("ascii", errors="replace")
                        (folder_path / "new" / f"{ts_us}.{seq}_{uid_str}.{hostname}").write_bytes(body)
                        total += 1
                        prog.messages_done += 1
                        if seq % 25 == 0:
                            prog.touch()
                    try:
                        imap.close()
                    except (imaplib.IMAP4.error, OSError):
                        pass
                    break  # folder complete
                except (imaplib.IMAP4.abort, OSError) as e:
                    drops += 1
                    if drops > MAX_DROPS_WITHOUT_PROGRESS:
                        raise RuntimeError(
                            f"IMAP connection dropped {drops} times in a row without progress "
                            f"in {display!r} (last error: {e})") from e
                    logger.warning(
                        "[mbbackup] IMAP connection lost (%s) — reconnect %d/%d, resuming %r at message %d/%d",
                        e, drops, MAX_DROPS_WITHOUT_PROGRESS, display, next_idx, len(uids or []))
                    try:
                        imap.logout()
                    except Exception:
                        pass
                    prog.phase = "reconnecting"
                    prog.touch()
                    for _ in range(min(30, 5 * drops)):  # backoff, still cancellable
                        _check_cancel(cancel)
                        time.sleep(1)
                    imap = _connect()
                    prog.phase = "fetching"
                    prog.touch()

            prog.folders_done += 1
            prog.touch()
        return total
    finally:
        try:
            imap.logout()
        except Exception:
            pass


def _archive_maildir(maildir: Path, archive: Path, prog: JobProgress) -> None:
    import zstandard as zstd
    s = get_settings()
    cctx = zstd.ZstdCompressor(level=s.MAILBOX_BACKUP_ZSTD_LEVEL, threads=-1)

    def _touch_filter(tarinfo: tarfile.TarInfo) -> tarfile.TarInfo:
        # Compressing a large mailbox can take far longer than the fetch phase
        # ever did — without a heartbeat per file added, the stall watchdog
        # would (wrongly) kill a job that's working fine, just slowly.
        prog.touch()
        return tarinfo

    with open(archive, "wb") as fout:
        with cctx.stream_writer(fout, closefd=False) as compressor:
            with tarfile.open(fileobj=compressor, mode="w|") as tar:
                tar.add(str(maildir), arcname=maildir.name, filter=_touch_filter)


def _sha256_file(path: Path, prog: JobProgress) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            prog.touch()
    return h.hexdigest()


def _maildir_to_mboxset(maildir: Path, out_dir: Path, prog: JobProgress) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    produced: list[Path] = []
    for sub in sorted(maildir.iterdir()):
        if not sub.is_dir():
            continue
        mbox_path = out_dir / f"{sub.name}.mbox"
        src = mailbox.Maildir(str(sub), create=False)
        dst = mailbox.mbox(str(mbox_path), create=True)
        try:
            dst.lock()
            for _key, msg in src.iteritems():
                dst.add(msg)
                prog.touch()
            dst.flush()
        finally:
            dst.unlock()
            dst.close()
            src.close()
        produced.append(mbox_path)
    return produced


def _make_s3_client():
    import boto3
    from botocore.config import Config as BotoConfig
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.S3_ENDPOINT_URL,
        region_name=s.S3_REGION,
        aws_access_key_id=s.S3_ACCESS_KEY_ID,
        aws_secret_access_key=s.S3_SECRET_ACCESS_KEY,
        config=BotoConfig(
            signature_version="s3v4",
            retries={"max_attempts": 5, "mode": "standard"},
            s3={"addressing_style": "virtual"},
        ),
    )


def _s3_upload(s3, local: Path, key: str, prog: JobProgress, metadata: Optional[dict] = None) -> dict:
    from botocore.exceptions import BotoCoreError, ClientError
    s = get_settings()
    extra: dict = {"StorageClass": s.S3_STORAGE_CLASS.upper()}
    if metadata:
        extra["Metadata"] = {k: str(v) for k, v in metadata.items()}
    try:
        # Callback fires per chunk sent — the heartbeat that keeps a large
        # (many-GB) upload from looking stalled to the watchdog.
        s3.upload_file(Filename=str(local), Bucket=s.S3_BUCKET, Key=key, ExtraArgs=extra,
                       Callback=lambda _bytes: prog.touch())
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"S3 upload failed for {key}: {e}") from e
    try:
        return s3.head_object(Bucket=s.S3_BUCKET, Key=key)
    except (ClientError, BotoCoreError) as e:
        logger.warning("[mbbackup] HEAD after upload failed for %s: %s", key, e)
        return {}


def _run_pipeline(email_addr: str, password: str, prog: JobProgress,
                  cancel: threading.Event) -> dict:
    """Full blocking pipeline. Returns result fields for the DB row."""
    s = get_settings()
    workdir = Path(tempfile.mkdtemp(prefix="mbbackup-"))
    try:
        maildir = workdir / "Maildir"
        total = _imap_pull(email_addr, password, maildir, prog, cancel)
        if total == 0:
            raise RuntimeError("mailbox produced 0 messages — nothing to back up "
                               "(is IMAP access enabled for this account?)")

        _check_cancel(cancel)
        prog.phase = "archiving"
        prog.touch()
        ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        archive_name = f"{_sanitize_filename(email_addr)}_{ts}.tar.zst"
        archive = workdir / archive_name
        _archive_maildir(maildir, archive, prog)

        local_sha = _sha256_file(archive, prog)
        sha_file = workdir / f"{archive_name}.sha256"
        sha_file.write_text(f"{local_sha}  {archive_name}\n", encoding="utf-8")

        _check_cancel(cancel)
        prog.phase = "uploading"
        prog.touch()
        s3 = _make_s3_client()
        prefix = s.S3_PREFIX.strip("/")
        backup_dirname = f"{_sanitize_filename(email_addr)}_{ts}"
        key_prefix = f"{prefix}/{backup_dirname}" if prefix else backup_dirname
        archive_key = f"{key_prefix}/{archive_name}"
        meta = {"sha256": local_sha, "email": email_addr, "backup-timestamp": ts}
        head = _s3_upload(s3, archive, archive_key, prog, metadata=meta)
        _s3_upload(s3, sha_file, f"{archive_key}.sha256", prog, metadata=meta)

        prog.phase = "verifying"
        prog.touch()
        local_size = archive.stat().st_size
        server_size = head.get("ContentLength") if head else None
        if head and server_size != local_size:
            raise RuntimeError(f"upload verification failed: size mismatch "
                               f"local={local_size} server={server_size}")

        prog.phase = "mbox"
        prog.touch()
        mbox_files = _maildir_to_mboxset(maildir, workdir / "mbox", prog)
        for mf in mbox_files:
            _s3_upload(s3, mf, f"{key_prefix}/mbox/{mf.name}", prog,
                       metadata={**meta, "mbox-folder": mf.stem})

        return {
            "archive_size": local_size,
            "sha256": local_sha,
            "s3_url": f"s3://{s.S3_BUCKET}/{archive_key}",
            "mbox_count": len(mbox_files),
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ─── async job wrapper ───────────────────────────────────────────────

def _swallow_late_result(fut: asyncio.Future) -> None:
    """Once we've given up on a stalled/canceled pipeline, its thread may still
    finish later (or never). Touch the result so asyncio doesn't log an
    'exception was never retrieved' warning for it."""
    if not fut.cancelled():
        fut.exception()


async def _run_pipeline_watched(email_addr: str, password: str, prog: JobProgress,
                                cancel: threading.Event) -> dict:
    """Run the blocking pipeline in a worker thread, but stop waiting on it if
    it goes silent for too long or gets canceled — a thread stuck inside a
    blocking syscall (e.g. a hung DNS lookup) can't be killed from here, so
    "giving up" means abandoning the thread and freeing the job queue rather
    than actually stopping it; it's left to finish or die on its own."""
    fut = asyncio.ensure_future(asyncio.to_thread(_run_pipeline, email_addr, password, prog, cancel))
    while True:
        done, _pending = await asyncio.wait({fut}, timeout=2)
        if fut in done:
            return fut.result()
        if cancel.is_set():
            fut.add_done_callback(_swallow_late_result)
            raise BackupCancelled()
        if time.time() - prog.updated_at > STALL_TIMEOUT_SEC:
            fut.add_done_callback(_swallow_late_result)
            raise RuntimeError(
                f"backup stalled — no progress for over {STALL_TIMEOUT_SEC}s, likely a network "
                f"call hung below the connection timeout. Gave up so the rest of the queue could "
                f"continue — retry this mailbox.")


async def run_backup_job(job_id: int, email_addr: str, password: str) -> None:
    """Execute one backup job; updates the DB row at start and finish."""
    email_key = email_addr.lower()
    prog = JOBS.setdefault(job_id, JobProgress())
    cancel = _CANCELS.setdefault(job_id, threading.Event())
    _RUNNING_EMAILS.add(email_key)
    try:
        # Serialize pipelines: batch submissions queue up and run one at a time.
        async with _GLOBAL_LOCK:
            # Canceled while still queued — the API already marked the DB row.
            if cancel.is_set():
                logger.info("[mbbackup] job %s for %s canceled while queued", job_id, email_addr)
                return

            async with AsyncSessionFactory() as db:
                job = await db.get(MailboxBackupJob, job_id)
                if not job:
                    return
                job.status = "running"
                job.started_at = utcnow()
                await db.commit()

            try:
                result = await _run_pipeline_watched(email_addr, password, prog, cancel)
                status, error = "success", None
            except BackupCancelled:
                result, status, error = {}, "canceled", None
            except Exception as e:  # noqa: BLE001
                logger.exception("[mbbackup] job %s for %s failed", job_id, email_addr)
                result, status, error = {}, "failed", str(e)[:2000]

        async with AsyncSessionFactory() as db:
            job = await db.get(MailboxBackupJob, job_id)
            if not job:
                return
            job.status = status
            job.error = error
            job.phase = "done" if status in ("success", "canceled") else prog.phase
            job.finished_at = utcnow()
            job.folders_total = prog.folders_total
            job.folders_done = prog.folders_done
            job.messages_total = prog.messages_total
            job.messages_done = prog.messages_done
            job.current_folder = None
            for k, v in result.items():
                setattr(job, k, v)
            await db.commit()
        logger.info("[mbbackup] job %s for %s finished: %s", job_id, email_addr, status)
    finally:
        _RUNNING_EMAILS.discard(email_key)
        JOBS.pop(job_id, None)
        _CANCELS.pop(job_id, None)


async def fail_stale_jobs() -> None:
    """On startup: mark jobs left 'running'/'queued' by a previous process as failed."""
    from sqlalchemy import select
    async with AsyncSessionFactory() as db:
        res = await db.execute(
            select(MailboxBackupJob).where(MailboxBackupJob.status.in_(("queued", "running")))
        )
        stale = res.scalars().all()
        for job in stale:
            job.status = "failed"
            job.error = "interrupted by a backend restart"
            job.finished_at = utcnow()
        if stale:
            await db.commit()
            logger.warning("[mbbackup] marked %d stale job(s) as failed", len(stale))
