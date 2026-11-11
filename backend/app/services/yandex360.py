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


def find_user(email: str, allow_blocked: bool = False) -> dict:
    """The directory entry for a login or an address (primary or alias).
    A blocked account is refused unless `allow_blocked` — the backup unblocks
    it itself (see set_enabled)."""
    def _lookup(force: bool) -> dict | None:
        with _users_lock:
            org = _cfg("YANDEX_ORG_ID")
            if force or time.time() - _users_cache["at"] > _USERS_TTL or _users_cache["org"] != org:
                _users_cache.update(by_email=_load_users(), at=time.time(), org=org)
            return _users_cache["by_email"].get(email.lower())

    user = _lookup(force=False)
    # The usual flow is "unblock the leaver, back up" — a cached listing would
    # still say blocked (or not hired yet), so check the directory again first.
    if not user or user.get("isEnabled") is False:
        user = _lookup(force=True)
    if not user:
        raise Yandex360Error(f"{email} is not an employee of the Yandex 360 organisation")
    if user.get("isEnabled") is False and not allow_blocked:
        raise Yandex360Error(f"{email} is blocked in Yandex 360 — unblock it for the backup, block it again after")
    return user


def set_enabled(uid: int | str, enabled: bool) -> None:
    """Block (False) or unblock (True) an employee. Needs the directory token
    to carry directory:write_users. Blocking keeps the mail and Disk; it only
    stops the employee from signing in."""
    org = _cfg("YANDEX_ORG_ID")
    r = httpx.patch(f"{API_360}/directory/v1/org/{org}/users/{uid}", timeout=30,
                    headers={"Authorization": f"OAuth {_cfg('YANDEX_DIRECTORY_TOKEN')}"},
                    json={"isEnabled": enabled})
    if r.status_code != 200:
        hint = " (does the directory token have directory:write_users?)" if r.status_code in (401, 403) else ""
        raise Yandex360Error(f"Yandex 360: could not {'unblock' if enabled else 'block'} user {uid}: "
                             f"HTTP {r.status_code} {r.text[:200]}{hint}")
    # The cached listing would otherwise still say the old state for up to _USERS_TTL.
    with _users_lock:
        for u in _users_cache["by_email"].values():
            if str(u.get("id")) == str(uid):
                u["isEnabled"] = enabled


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
