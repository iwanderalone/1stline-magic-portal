"""Yandex 360 service application — act as any employee without their password.

The organisation's service application exchanges an employee's uid for a
one-hour OAuth token (RFC 8693 token exchange). With it the backup tool reads
the personal Disk (cloud_api:disk.read) and the mailbox over IMAP XOAUTH2
(mail:imap_ro). The uid comes from the 360 directory (directory:read_users).
Ported from the standalone yd2nc backup script, which uses the same app.

Everything here is synchronous: it runs inside the backup worker thread.
"""
from __future__ import annotations

import threading
import time

import httpx

from app.core.config import get_settings

OAUTH_URL = "https://oauth.yandex.ru/token"
API_360 = "https://api360.yandex.net"
DISK_API = "https://cloud-api.yandex.net/v1/disk"

_USERS_TTL = 600  # the directory changes rarely; one listing serves a whole batch
_users_cache: dict = {"at": 0.0, "org": None, "by_email": {}}
_users_lock = threading.Lock()


class Yandex360Error(RuntimeError):
    pass


def _cfg(key: str) -> str:
    from app.core.dynamic_settings import eff
    return (eff(key, getattr(get_settings(), key)) or "").strip()


def enabled() -> bool:
    return all(_cfg(k) for k in ("YANDEX_ORG_ID", "YANDEX_DIRECTORY_TOKEN",
                                  "YANDEX_CLIENT_ID", "YANDEX_CLIENT_SECRET"))


def _load_users() -> dict[str, dict]:
    org = _cfg("YANDEX_ORG_ID")
    headers = {"Authorization": f"OAuth {_cfg('YANDEX_DIRECTORY_TOKEN')}"}
    by_email: dict[str, dict] = {}
    page = 1
    with httpx.Client(timeout=30) as client:
        while True:
            r = client.get(f"{API_360}/directory/v1/org/{org}/users",
                           params={"page": page, "perPage": 1000}, headers=headers)
            if r.status_code != 200:
                raise Yandex360Error(f"Yandex 360 directory: HTTP {r.status_code} {r.text[:200]} "
                                     f"(check YANDEX_ORG_ID and the directory token's directory:read_users)")
            data = r.json()
            for u in data.get("users", []):
                if u.get("nickname"):
                    by_email.setdefault(u["nickname"].lower(), u)   # bare login
                for addr in [u.get("email"), *(u.get("aliases") or [])]:
                    if not addr:
                        continue
                    addr = addr.lower()
                    if "@" not in addr and u.get("email"):   # aliases are bare logins
                        addr = f"{addr}@{u['email'].split('@', 1)[1].lower()}"
                    by_email.setdefault(addr, u)
            if page >= data.get("pages", 1):
                return by_email
            page += 1


def find_user(email: str) -> dict:
    """The directory entry for a login or an address (primary or alias)."""
    with _users_lock:
        org = _cfg("YANDEX_ORG_ID")
        if time.time() - _users_cache["at"] > _USERS_TTL or _users_cache["org"] != org:
            _users_cache.update(by_email=_load_users(), at=time.time(), org=org)
        user = _users_cache["by_email"].get(email.lower())
    if not user:
        raise Yandex360Error(f"{email} is not an employee of the Yandex 360 organisation")
    if user.get("isEnabled") is False:
        raise Yandex360Error(f"{email} is blocked in Yandex 360 — unblock it for the backup, block it again after")
    return user


class EmployeeToken:
    """A one-hour token for one employee, renewed 5 minutes before it expires."""

    def __init__(self, email: str):
        self.email = email
        self.uid = str(find_user(email)["id"])
        self._lock = threading.Lock()
        self._token, self._expires = None, 0.0

    def get(self, force: bool = False) -> str:
        with self._lock:
            if force or not self._token or time.time() > self._expires - 300:
                r = httpx.post(OAUTH_URL, timeout=30, data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
                    "client_id": _cfg("YANDEX_CLIENT_ID"),
                    "client_secret": _cfg("YANDEX_CLIENT_SECRET"),
                    "subject_token": self.uid,
                    "subject_token_type": "urn:yandex:params:oauth:token-type:uid",
                })
                if r.status_code != 200:
                    raise Yandex360Error(f"employee token for {self.email}: HTTP {r.status_code} {r.text[:200]} "
                                         f"(is the service application registered with this scope?)")
                data = r.json()
                self._token = data["access_token"]
                self._expires = time.time() + int(data.get("expires_in", 3600))
            return self._token

    def xoauth2(self) -> bytes:
        return f"user={self.email}\x01auth=Bearer {self.get()}\x01\x01".encode()
