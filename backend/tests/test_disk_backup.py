"""Disk backup pipeline end to end against a mocked Disk API and an in-memory S3."""
import hashlib
import io
import tarfile
import threading

import httpx
import pytest
import zstandard

from app.core import dynamic_settings
from app.services import disk_backup_service as dbs
from app.services import mailbox_backup_service as mbs
from app.services import yandex360

FILES = {"/a.txt": b"hello", "/Docs/b.bin": b"0123456789"}
md5 = lambda b: hashlib.md5(b).hexdigest()  # noqa: E731


def _item(path, kind="file", body=b"", **over):
    return {"name": path.rsplit("/", 1)[1], "type": kind, "size": len(body), "md5": md5(body),
            "modified": "2026-10-01T10:00:00+00:00", **over}


LISTING = {
    "disk:/": [_item("/Docs", "dir"), _item("/a.txt", body=FILES["/a.txt"]),
               _item("/Bears.jpg", body=b"x", md5="569a1c98696050439b5b2a1ecfa52d19")],
    "disk:/Docs": [_item("/Docs/b.bin", body=FILES["/Docs/b.bin"]), _item("/Docs/gone.pdf", body=b"zzz")],
}


def handler(req: httpx.Request):
    if req.url.host == "dl.test":
        body = FILES[req.url.path]
        rng = req.headers.get("Range")
        if req.url.path == "/Docs/b.bin" and not rng:
            return httpx.Response(200, content=body[:4])          # drops after 4 bytes
        if rng:
            return httpx.Response(206, content=body[int(rng[6:-1]):])
        return httpx.Response(200, content=body)
    path = req.url.params["path"]
    if req.url.path.endswith("/resources/download"):
        if path == "disk:/Docs/gone.pdf":
            return httpx.Response(404, json={"error": "DiskNotFoundError"})
        return httpx.Response(200, json={"href": f"https://dl.test{path[5:]}"})
    items = LISTING[path]
    return httpx.Response(200, json={"_embedded": {"items": items, "total": len(items)}})


class FakeS3:
    def __init__(self):
        self.objects, self.parts = {}, {}

    def create_multipart_upload(self, Bucket, Key, **kw):
        self.parts[Key] = []
        return {"UploadId": "u1"}

    def upload_part(self, Bucket, Key, UploadId, PartNumber, Body):
        self.parts[Key].append(Body)
        return {"ETag": f"e{PartNumber}"}

    def complete_multipart_upload(self, Bucket, Key, UploadId, MultipartUpload):
        self.objects[Key] = b"".join(self.parts.pop(Key))

    def abort_multipart_upload(self, **kw):
        raise AssertionError("aborted")

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None, Callback=None):
        self.objects[Key] = open(Filename, "rb").read()

    def head_object(self, Bucket, Key):
        return {"ContentLength": len(self.objects[Key])}


class StubToken:
    def __init__(self, email):
        pass

    def get(self, force=False):
        return "tok"


def test_disk_pipeline_archives_resumes_and_skips(monkeypatch):
    real = httpx.Client
    monkeypatch.setattr(dbs.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(dbs, "EmployeeToken", StubToken)
    monkeypatch.setattr(dbs.time, "sleep", lambda s: None)
    monkeypatch.setattr(dbs, "RETRY_PASS_PAUSE", 0)
    s3 = FakeS3()
    monkeypatch.setattr(mbs, "_make_s3_client", lambda: s3)

    prog = mbs.JobProgress()
    out = dbs.run_pipeline("ivan@example.com", prog, threading.Event())

    archive_key = out["s3_url"].split("/", 3)[3]
    assert archive_key.startswith("Backups/Yandex Disks/ivan@example.com_")
    assert archive_key.endswith(".disk.tar.zst")
    data = s3.objects[archive_key]
    assert out["archive_size"] == len(data) and out["sha256"] == hashlib.sha256(data).hexdigest()
    assert out["skipped"] == 1
    assert "gone.pdf" in s3.objects[archive_key + ".skipped.tsv"].decode()
    assert archive_key + ".sha256" in s3.objects

    raw = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data)).read()
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        got = {m.name: tar.extractfile(m).read() for m in tar.getmembers()}
    assert got == {"disk/a.txt": b"hello", "disk/Docs/b.bin": b"0123456789"}   # welcome picture left out
    assert prog.messages_done == 2 and prog.messages_total == 3


def test_s3_writer_splits_into_parts(monkeypatch):
    monkeypatch.setattr(dbs, "PART_SIZE", 4)
    s3 = FakeS3()
    w = dbs.S3StreamWriter(s3, "b", "k", "STANDARD", {}, mbs.JobProgress())
    w.write(b"0123456789")
    assert len(s3.parts["k"]) == 2
    w.finish()
    assert s3.objects["k"] == b"0123456789" and w.size == 10


@pytest.fixture
def directory(monkeypatch):
    monkeypatch.setattr(dynamic_settings, "_cache", {"YANDEX_ORG_ID": "1"})
    monkeypatch.setattr(yandex360, "_users_cache", {"at": 0.0, "org": None, "by_email": {}})
    monkeypatch.setattr(yandex360, "_load_users", lambda: {
        "ivan@example.com": {"id": 11, "email": "ivan@example.com", "isEnabled": True},
        "i.petrov@example.com": {"id": 11, "email": "ivan@example.com", "isEnabled": True},
        "gone@example.com": {"id": 12, "email": "gone@example.com", "isEnabled": False},
    })


def test_find_user_by_alias_and_refuses_blocked(directory):
    assert yandex360.find_user("I.Petrov@example.com")["id"] == 11
    with pytest.raises(yandex360.Yandex360Error, match="blocked"):
        yandex360.find_user("gone@example.com")
    with pytest.raises(yandex360.Yandex360Error, match="not an employee"):
        yandex360.find_user("stranger@example.com")


def test_unblocked_user_is_seen_without_waiting_for_the_cache(directory, monkeypatch):
    with pytest.raises(yandex360.Yandex360Error, match="blocked"):
        yandex360.find_user("gone@example.com")
    monkeypatch.setattr(yandex360, "_load_users", lambda: {
        "gone@example.com": {"id": 12, "email": "gone@example.com", "isEnabled": True}})
    assert yandex360.find_user("gone@example.com")["id"] == 12


def test_files_download_in_parallel(monkeypatch):
    """A folder of small files must not be fetched one at a time."""
    many = {f"/f{i}.png": bytes([i]) * 10 for i in range(12)}
    lock, active, peak = threading.Lock(), [0], [0]
    gate = threading.Event()

    def slow(req: httpx.Request):
        if req.url.host == "dl.test":
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
                if active[0] >= 3:
                    gate.set()
            gate.wait(2)   # hold each download until several are in flight at once
            with lock:
                active[0] -= 1
            return httpx.Response(200, content=many[req.url.path])
        path = req.url.params["path"]
        if req.url.path.endswith("/resources/download"):
            return httpx.Response(200, json={"href": f"https://dl.test{path[5:]}"})
        items = [_item(p, body=b) for p, b in many.items()]
        return httpx.Response(200, json={"_embedded": {"items": items, "total": len(items)}})

    real = httpx.Client
    monkeypatch.setattr(dbs.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(slow), **kw))
    monkeypatch.setattr(dbs, "EmployeeToken", StubToken)
    monkeypatch.setattr(dbs, "RETRY_PASS_PAUSE", 0)
    s3 = FakeS3()
    monkeypatch.setattr(mbs, "_make_s3_client", lambda: s3)

    prog = mbs.JobProgress()
    out = dbs.run_pipeline("ivan@example.com", prog, threading.Event())

    assert peak[0] >= 3
    assert out["skipped"] == 0 and prog.messages_done == 12


def _run_with(monkeypatch, handler_fn):
    real = httpx.Client
    monkeypatch.setattr(dbs.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler_fn), **kw))
    monkeypatch.setattr(dbs, "EmployeeToken", StubToken)
    monkeypatch.setattr(dbs, "RETRY_PASS_PAUSE", 0)
    monkeypatch.setattr(dbs.time, "sleep", lambda s: None)
    monkeypatch.setattr(dbs.DiskClient, "_cool_down", lambda self, cancel: None)
    s3 = FakeS3()
    monkeypatch.setattr(mbs, "_make_s3_client", lambda: s3)
    prog = mbs.JobProgress()
    out = dbs.run_pipeline("ivan@example.com", prog, threading.Event())
    data = s3.objects[out["s3_url"].split("/", 3)[3]]
    raw = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data)).read()
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        names = {m.name for m in tar.getmembers()}
    return out, names


def test_throttled_link_requests_are_retried_not_skipped(monkeypatch):
    """429 on the download-link request must not cost a file."""
    body = b"payload"
    calls = {"link": 0}

    def h(req: httpx.Request):
        if req.url.host == "dl.test":
            return httpx.Response(200, content=body)
        if req.url.path.endswith("/resources/download"):
            calls["link"] += 1
            if calls["link"] <= 3:
                return httpx.Response(429, headers={"Retry-After": "1"}, json={"error": "TooManyRequests"})
            return httpx.Response(200, json={"href": "https://dl.test/x"})
        items = [_item("/x.bin", body=body)]
        return httpx.Response(200, json={"_embedded": {"items": items, "total": 1}})

    out, names = _run_with(monkeypatch, h)
    assert out["skipped"] == 0 and names == {"disk/x.bin"}


def test_file_that_keeps_failing_in_parallel_gets_a_second_pass(monkeypatch):
    """Throttled past every in-pass retry, the file still makes it via the sequential pass."""
    body = b"payload"
    calls = {"link": 0}

    def h(req: httpx.Request):
        if req.url.host == "dl.test":
            return httpx.Response(200, content=body)
        if req.url.path.endswith("/resources/download"):
            calls["link"] += 1
            if calls["link"] <= dbs.LINK_ATTEMPTS:   # the whole first pass is throttled
                return httpx.Response(503)
            return httpx.Response(200, json={"href": "https://dl.test/x"})
        items = [_item("/x.bin", body=body)]
        return httpx.Response(200, json={"_embedded": {"items": items, "total": 1}})

    out, names = _run_with(monkeypatch, h)
    assert out["skipped"] == 0 and names == {"disk/x.bin"}
