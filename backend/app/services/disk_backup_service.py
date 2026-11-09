"""Disk half of the backup tool — an employee's personal Yandex Disk → .tar.zst → S3.

Runs in the same job queue as the mailbox backup (see mailbox_backup_service:
progress registry, cancel flags, watchdog) and writes its own archive next to
the mail one, under S3_DISK_PREFIX. Access is through the Yandex 360 service
application, so no password is involved.

Nothing as large as the whole disk ever touches local storage: each file is
spooled to a temp file (so a dropped download can resume and its md5 can be
checked before it goes into the tar), appended to the tar, deleted, and the
compressed stream goes to S3 as a multipart upload while it is produced.

A file Yandex cannot serve ("no more reliable hosts", repeated drops, md5
mismatch) is skipped rather than failing the job; the list goes to S3 next to
the archive. Download behaviour (first-byte timeout, Range resume, the stock
welcome pictures) follows the yd2nc script.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import logging
import shutil
import tarfile
import tempfile
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.services import mailbox_backup_service as mbs
from app.services.yandex360 import DISK_API, EmployeeToken

logger = logging.getLogger(__name__)

FIRST_BYTE_TIMEOUT = 45   # Yandex storage sometimes accepts the connection and never sends a byte
RESUMES = 5               # Range resumes per file before it is skipped
LIST_ATTEMPTS = 4
PART_SIZE = 128 * 1024 * 1024   # S3 multipart part; 10 000 parts → archives up to ~1.2 TiB
# Files are fetched in parallel: one at a time, a folder of small files spends
# almost all its time on the download-link request and the redirect rather than
# on bytes, and Yandex also caps a single download stream's speed.
DOWNLOAD_WORKERS = 8
INFLIGHT_BYTES = 4 * 1024 ** 3  # stop queueing more files while this much is being spooled
_PROG_LOCK = threading.Lock()
# Pictures every new Yandex Disk starts with — not worth keeping.
WELCOME_MD5 = {
    "569a1c98696050439b5b2a1ecfa52d19", "d27d72a3059ad5ebed7a5470459d2670",
    "1392851f0668017168ee4b5a59d66e7b", "ab903d9cab031eca2a8f12f37bbc9d37",
    "f1abe3b27b410128623fd1ca00a45c29", "a64146fee5e15b3b94c204e544426d43",
}


class FileUnavailable(Exception):
    """One file could not be fetched — skip it, keep the job going."""


def _add_bytes(prog: mbs.JobProgress, n: int) -> None:
    with _PROG_LOCK:   # several download threads update the same counter
        prog.bytes_done += n
        prog.touch()


class DiskClient:
    def __init__(self, token: EmployeeToken):
        self.token = token
        self.http = httpx.Client(timeout=httpx.Timeout(60, read=FIRST_BYTE_TIMEOUT))

    def close(self):
        self.http.close()

    def _get(self, url: str, **kw) -> httpx.Response:
        r = None
        for attempt in range(2):   # 401 = the hour is up; take a fresh token once
            r = self.http.get(url, headers={"Authorization": f"OAuth {self.token.get(force=attempt > 0)}"}, **kw)
            if r.status_code != 401:
                break
        return r

    def list_dir(self, path: str) -> list[dict]:
        items, offset = [], 0
        while True:
            for attempt in range(1, LIST_ATTEMPTS + 1):
                try:
                    r = self._get(f"{DISK_API}/resources", params={
                        "path": f"disk:{path}", "limit": 1000, "offset": offset,
                        "fields": "_embedded.total,_embedded.items.name,_embedded.items.type,"
                                  "_embedded.items.size,_embedded.items.md5,_embedded.items.modified"})
                    if r.status_code < 500 and r.status_code != 429:
                        break
                except httpx.HTTPError as e:
                    if attempt == LIST_ATTEMPTS:
                        raise RuntimeError(f"Disk listing {path}: {e}") from e
                time.sleep(5 * attempt)
            if r.status_code == 404 and path == "/":
                raise RuntimeError("this employee has no Yandex Disk")
            if r.status_code != 200:
                raise RuntimeError(f"Disk listing {path}: HTTP {r.status_code} {r.text[:200]}")
            emb = r.json().get("_embedded", {})
            page = emb.get("items", [])
            for item in page:
                item["rel"] = f"{path.rstrip('/')}/{item['name']}"
            items += page
            offset += len(page)
            if not page or offset >= emb.get("total", 0):
                return items

    def walk(self, prog: mbs.JobProgress, cancel: threading.Event) -> list[dict]:
        files, pending = [], ["/"]
        while pending:
            mbs._check_cancel(cancel)
            path = pending.pop()
            prog.current_folder = path
            for item in self.list_dir(path):
                if item["type"] == "dir":
                    pending.append(item["rel"])
                else:
                    files.append(item)
                    prog.messages_total = len(files)
            prog.touch()
        return files

    def download(self, item: dict, dest: Path, prog: mbs.JobProgress, cancel: threading.Event) -> None:
        """Fetch one file to dest, resuming with Range after a drop; md5-checked.
        Safe to call from several threads at once. A file that ends up skipped
        still counts its full size towards progress, so the bar stays honest."""
        size = int(item.get("size") or 0)
        counted = [0]
        try:
            self._download(item, dest, prog, cancel, counted)
        except FileUnavailable:
            _add_bytes(prog, max(0, size - counted[0]))
            raise

    def _download(self, item: dict, dest: Path, prog: mbs.JobProgress, cancel: threading.Event,
                  counted: list[int]) -> None:
        path, size = item["rel"], int(item.get("size") or 0)
        r = self._get(f"{DISK_API}/resources/download", params={"path": f"disk:{path}"})
        if r.status_code != 200:
            raise FileUnavailable(f"no download link: HTTP {r.status_code} {r.text[:150]}")
        href = r.json()["href"]
        got, drops = 0, 0
        md5 = hashlib.md5()
        with dest.open("wb") as out:
            while True:
                mbs._check_cancel(cancel)
                try:
                    headers = {"Authorization": f"OAuth {self.token.get()}"}
                    if got:
                        headers["Range"] = f"bytes={got}-"
                    with self.http.stream("GET", href, headers=headers, follow_redirects=True) as resp:
                        if resp.status_code not in (200, 206):
                            raise FileUnavailable(f"HTTP {resp.status_code} {resp.read()[:150]!r}")
                        if got and resp.status_code != 206:
                            raise FileUnavailable("the server cannot resume this file")
                        for block in resp.iter_bytes(1 << 20):
                            out.write(block)
                            md5.update(block)
                            got += len(block)
                            counted[0] += len(block)
                            _add_bytes(prog, len(block))
                            mbs._check_cancel(cancel)
                    if got >= size:
                        break
                    raise httpx.ReadError(f"stream ended at {got} of {size} bytes")
                except httpx.HTTPError as e:
                    drops += 1
                    if drops > RESUMES:
                        raise FileUnavailable(f"{drops} drops while downloading, last: {e}") from e
                    time.sleep(min(30, 3 * drops))
        if item.get("md5") and md5.hexdigest() != item["md5"]:
            raise FileUnavailable("md5 does not match Yandex's")


class S3StreamWriter:
    """File-like sink that uploads what is written to it as an S3 multipart upload."""

    def __init__(self, s3, bucket: str, key: str, storage_class: str, metadata: dict, prog: mbs.JobProgress):
        self.s3, self.bucket, self.key, self.prog = s3, bucket, key, prog
        self.upload_id = s3.create_multipart_upload(
            Bucket=bucket, Key=key, StorageClass=storage_class,
            Metadata={k: str(v) for k, v in metadata.items()})["UploadId"]
        self.buf = bytearray()
        self.parts: list[dict] = []
        self.size = 0
        self.sha = hashlib.sha256()

    def writable(self) -> bool:
        return True

    def write(self, data) -> int:
        self.buf += data
        self.sha.update(data)
        self.size += len(data)
        while len(self.buf) >= PART_SIZE:
            self._send(PART_SIZE)
        return len(data)

    def flush(self):
        pass

    def _send(self, n: int):
        body = bytes(self.buf[:n])
        del self.buf[:n]
        number = len(self.parts) + 1
        resp = self.s3.upload_part(Bucket=self.bucket, Key=self.key, UploadId=self.upload_id,
                                   PartNumber=number, Body=body)
        self.parts.append({"ETag": resp["ETag"], "PartNumber": number})
        self.prog.touch()

    def finish(self):
        if self.buf or not self.parts:
            self._send(len(self.buf))
        self.s3.complete_multipart_upload(Bucket=self.bucket, Key=self.key, UploadId=self.upload_id,
                                          MultipartUpload={"Parts": self.parts})

    def abort(self):
        try:
            self.s3.abort_multipart_upload(Bucket=self.bucket, Key=self.key, UploadId=self.upload_id)
        except Exception as e:  # noqa: BLE001 — the original error matters more
            logger.warning("[diskbackup] could not abort multipart upload %s: %s", self.key, e)


def _tar_info(item: dict, size: int) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name="disk" + item["rel"])
    info.size = size
    try:
        info.mtime = int(dt.datetime.fromisoformat(item["modified"]).timestamp())
    except (KeyError, TypeError, ValueError):
        info.mtime = int(time.time())
    return info


def run_pipeline(email_addr: str, prog: mbs.JobProgress, cancel: threading.Event) -> dict:
    """Full blocking pipeline. Returns result fields for the DB row."""
    import zstandard as zstd
    from app.core.dynamic_settings import eff
    s = get_settings()

    prog.phase = "connecting"
    prog.touch()
    disk = DiskClient(EmployeeToken(email_addr))
    workdir = Path(tempfile.mkdtemp(prefix="diskbackup-"))
    try:
        prog.phase = "listing"
        prog.touch()
        files = [f for f in disk.walk(prog, cancel) if f.get("md5") not in WELCOME_MD5]
        prog.messages_total = len(files)
        prog.messages_done = 0
        prog.bytes_total = sum(int(f.get("size") or 0) for f in files)
        prog.bytes_done = 0

        ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        name = mbs._sanitize_filename(email_addr)
        prefix = eff("S3_DISK_PREFIX", s.S3_DISK_PREFIX).strip("/")
        key_prefix = f"{prefix}/{name}_{ts}" if prefix else f"{name}_{ts}"
        archive_name = f"{name}_{ts}.disk.tar.zst"
        archive_key = f"{key_prefix}/{archive_name}"
        meta = {"email": email_addr, "backup-timestamp": ts, "files": len(files)}

        s3 = mbs._make_s3_client()
        storage_class = eff("S3_STORAGE_CLASS", s.S3_STORAGE_CLASS).upper()
        level = eff("MAILBOX_BACKUP_ZSTD_LEVEL", s.MAILBOX_BACKUP_ZSTD_LEVEL, cast=int)
        writer = S3StreamWriter(s3, s.S3_BUCKET, archive_key, storage_class, meta, prog)
        skipped: list[tuple[str, int, str]] = []
        spool = workdir / "spool"
        spool.mkdir()
        stop = threading.Event()   # the download threads' own cancel flag: set on cancel *and* on failure

        def fetch(idx: int, item: dict) -> tuple[dict, Path | None, str | None]:
            dest = spool / str(idx)
            prog.current_folder = item["rel"]
            try:
                disk.download(item, dest, prog, stop)
                return item, dest, None
            except FileUnavailable as e:
                dest.unlink(missing_ok=True)
                return item, None, str(e)
            except BaseException:
                dest.unlink(missing_ok=True)
                raise

        prog.phase = "downloading"
        prog.touch()
        pool = ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS, thread_name_prefix="diskbackup")
        try:
            cctx = zstd.ZstdCompressor(level=level, threads=-1)
            with cctx.stream_writer(writer, closefd=False) as compressor:
                with tarfile.open(fileobj=compressor, mode="w|") as tar:
                    # Downloads run ahead in the pool; this thread appends whatever
                    # finished to the tar (order inside the archive doesn't matter).
                    queue = iter(enumerate(files))
                    running: dict = {}   # future → size in flight
                    while True:
                        if cancel.is_set():
                            stop.set()
                        mbs._check_cancel(cancel)
                        inflight = sum(running.values())
                        while len(running) < DOWNLOAD_WORKERS * 2 and (not running or inflight < INFLIGHT_BYTES):
                            nxt = next(queue, None)
                            if nxt is None:
                                break
                            size = int(nxt[1].get("size") or 0)
                            running[pool.submit(fetch, *nxt)] = size
                            inflight += size
                        if not running:
                            break
                        done, _ = wait(running, timeout=5, return_when=FIRST_COMPLETED)
                        for fut in done:
                            running.pop(fut)
                            item, path, err = fut.result()
                            if err is not None:
                                logger.warning("[diskbackup] %s: skipping %s: %s", email_addr, item["rel"], err)
                                skipped.append((item["rel"], int(item.get("size") or 0), err))
                                continue
                            try:
                                with path.open("rb") as fh:
                                    tar.addfile(_tar_info(item, path.stat().st_size), fh)
                            finally:
                                path.unlink(missing_ok=True)
                            prog.messages_done += 1
                            prog.touch()
            writer.finish()
        except BaseException:
            stop.set()   # the download threads still running give up at their next block
            writer.abort()
            raise
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

        prog.phase = "verifying"
        prog.current_folder = ""
        prog.bytes_total = prog.bytes_done = 0
        prog.touch()
        sha = writer.sha.hexdigest()
        side = workdir / f"{archive_name}.sha256"
        side.write_text(f"{sha}  {archive_name}\n", encoding="utf-8")
        mbs._s3_upload(s3, side, f"{archive_key}.sha256", prog, metadata=meta)
        if skipped:
            report = workdir / f"{archive_name}.skipped.tsv"
            report.write_text("path\tsize\treason\n" + "".join(f"{p}\t{n}\t{r}\n" for p, n, r in skipped),
                              encoding="utf-8")
            mbs._s3_upload(s3, report, f"{archive_key}.skipped.tsv", prog, metadata=meta)
        head = s3.head_object(Bucket=s.S3_BUCKET, Key=archive_key)
        if head.get("ContentLength") != writer.size:
            raise RuntimeError(f"upload verification failed: size mismatch "
                               f"local={writer.size} server={head.get('ContentLength')}")
        return {
            "archive_size": writer.size,
            "sha256": sha,
            "s3_url": f"s3://{s.S3_BUCKET}/{archive_key}",
            "skipped": len(skipped),
        }
    finally:
        disk.close()
        shutil.rmtree(workdir, ignore_errors=True)
