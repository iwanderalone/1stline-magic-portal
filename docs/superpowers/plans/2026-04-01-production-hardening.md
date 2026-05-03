# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 1stline-Magic-Portal secure, stable, consistent, and production-ready without introducing new features or speculative abstractions.

**Architecture:** Three independent phases that can each be deployed on their own: (A) Security Hardening, (B) Code Consistency, (C) Production Readiness. Execute A first since it touches foundational files others depend on.

**Tech Stack:** FastAPI 0.115, SQLAlchemy 2.0 async, SQLite WAL, React 18 + Vite 5, APScheduler 3.10, cryptography (already transitive dep via python-jose), pytest + httpx for backend tests.

---

## Pre-flight: Understand the codebase

Before touching any task, read these files to orient yourself:
- `backend/app/main.py` — lifespan, router registration, migrations
- `backend/app/models/models.py` — all 18 ORM models
- `backend/app/schemas/schemas.py` — all Pydantic schemas
- `backend/app/core/deps.py` — get_current_user, require_admin, get_or_404
- `backend/app/core/config.py` — Settings class

---

## PHASE A — Security Hardening

> These tasks address vulnerabilities that could expose user data or allow unauthorized access.

---

### Task A1: Set up pytest + async test infrastructure

Without tests, security changes can't be verified. Set this up first.

**Files:**
- Create: `backend/pytest.ini`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: Install test deps**

```bash
cd backend
source venv/bin/activate
pip install pytest pytest-asyncio httpx
pip freeze | grep -E "pytest|httpx" >> requirements.txt
```

- [ ] **Step 2: Create pytest.ini**

```ini
# backend/pytest.ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

- [ ] **Step 3: Create conftest.py**

```python
# backend/tests/conftest.py
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.main import app
from app.core.database import Base, get_db

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.fixture(scope="function")
async def db_engine():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()

@pytest.fixture(scope="function")
async def db_session(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with factory() as session:
        yield session

@pytest.fixture(scope="function")
async def client(db_session):
    async def override_get_db():
        yield db_session
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Create a smoke test to verify setup works**

```python
# backend/tests/test_health.py
import pytest

async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
```

- [ ] **Step 5: Run tests**

```bash
cd backend && pytest tests/test_health.py -v
```
Expected: `PASSED`

- [ ] **Step 6: Commit**

```bash
git add backend/pytest.ini backend/tests/ backend/requirements.txt
git commit -m "test: add pytest + async test infrastructure"
```

---

### Task A2: Validate secrets at startup — reject defaults

**Problem:** `SECRET_KEY` and `JWT_SECRET` have insecure defaults. If `.env` is not configured, the app runs with known-weak secrets.
**File:** `backend/app/core/config.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_config.py
import pytest
from pydantic import ValidationError

def test_weak_secret_key_raises():
    from app.core.config import Settings
    with pytest.raises((ValueError, RuntimeError)):
        Settings(
            SECRET_KEY="change-me-in-production",
            JWT_SECRET="a" * 64,
        )

def test_weak_jwt_secret_raises():
    from app.core.config import Settings
    with pytest.raises((ValueError, RuntimeError)):
        Settings(
            SECRET_KEY="a" * 32,
            JWT_SECRET="change-me-use-openssl-rand-hex-64",
        )

def test_short_secret_key_raises():
    from app.core.config import Settings
    with pytest.raises((ValueError, RuntimeError)):
        Settings(SECRET_KEY="short", JWT_SECRET="a" * 64)
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_config.py -v
```
Expected: FAIL — `Settings` currently accepts weak values.

- [ ] **Step 3: Read the current config.py fully**

```bash
cat backend/app/core/config.py
```

- [ ] **Step 4: Add validators to Settings**

Open `backend/app/core/config.py`. Find the `Settings` class and add validators after the field definitions:

```python
from pydantic import field_validator
# ... existing imports ...

class Settings(BaseSettings):
    # ... existing fields ...

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_strong(cls, v: str) -> str:
        weak_patterns = ["change-me", "change_me", "secret", "changeme", "example"]
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        if any(p in v.lower() for p in weak_patterns):
            raise ValueError(
                "SECRET_KEY looks like a default placeholder. "
                "Generate one with: openssl rand -hex 32"
            )
        return v

    @field_validator("JWT_SECRET")
    @classmethod
    def jwt_secret_must_be_strong(cls, v: str) -> str:
        weak_patterns = ["change-me", "change_me", "secret", "changeme", "example"]
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        if any(p in v.lower() for p in weak_patterns):
            raise ValueError(
                "JWT_SECRET looks like a default placeholder. "
                "Generate one with: openssl rand -hex 64"
            )
        return v
```

- [ ] **Step 5: Update .env.example to explain why**

In `.env.example`, ensure these lines exist:
```
# REQUIRED — generate with: openssl rand -hex 32
SECRET_KEY=
# REQUIRED — generate with: openssl rand -hex 64
JWT_SECRET=
```

- [ ] **Step 6: Run tests**

```bash
cd backend && pytest tests/test_config.py -v
```
Expected: all PASSED

- [ ] **Step 7: Commit**

```bash
git add backend/app/core/config.py .env.example backend/tests/test_config.py
git commit -m "security: reject weak/default SECRET_KEY and JWT_SECRET at startup"
```

---

### Task A3: Encrypt IMAP passwords at rest

**Problem:** `MailboxConfig.password` is stored as plaintext VARCHAR in SQLite. Database file exposure = all IMAP credentials leaked.
**Solution:** Fernet symmetric encryption using a key derived from `SECRET_KEY`. `cryptography` is already a transitive dependency via `python-jose[cryptography]`.

**Files:**
- Create: `backend/app/core/encryption.py`
- Modify: `backend/app/api/mail_reporter.py` (encrypt on write, decrypt on read)
- Modify: `backend/app/services/mail_reporter_service.py` (decrypt before connecting)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_encryption.py
import pytest
import os
os.environ.setdefault("SECRET_KEY", "a" * 32)
os.environ.setdefault("JWT_SECRET", "b" * 64)

def test_encrypt_decrypt_roundtrip():
    from app.core.encryption import encrypt, decrypt
    plaintext = "my-imap-password-123"
    ciphertext = encrypt(plaintext)
    assert ciphertext != plaintext
    assert decrypt(ciphertext) == plaintext

def test_encrypt_returns_different_each_time():
    from app.core.encryption import encrypt
    # Fernet uses random IVs — same plaintext → different ciphertext
    a = encrypt("password")
    b = encrypt("password")
    assert a != b

def test_decrypt_invalid_token_raises():
    from app.core.encryption import decrypt
    import pytest
    with pytest.raises(Exception):
        decrypt("not-valid-base64-token")
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_encryption.py -v
```
Expected: ImportError — module doesn't exist yet.

- [ ] **Step 3: Create encryption.py**

```python
# backend/app/core/encryption.py
"""
Fernet symmetric encryption for sensitive fields (e.g. IMAP passwords).

Key derivation: SHA-256 of SECRET_KEY, base64-urlsafe-encoded to 32 bytes.
The encryption key is deterministic from SECRET_KEY so no separate key
storage is needed — but changing SECRET_KEY will break existing ciphertext.
"""
import base64
import hashlib
from cryptography.fernet import Fernet
from app.core.config import get_settings


def _get_fernet() -> Fernet:
    settings = get_settings()
    # Derive a 32-byte key from SECRET_KEY via SHA-256
    raw = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns a URL-safe base64 token."""
    if not plaintext:
        return plaintext
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a Fernet token back to plaintext. Raises InvalidToken on failure."""
    if not ciphertext:
        return ciphertext
    return _get_fernet().decrypt(ciphertext.encode()).decode()
```

- [ ] **Step 4: Run encryption tests**

```bash
cd backend && pytest tests/test_encryption.py -v
```
Expected: all PASSED

- [ ] **Step 5: Update mail_reporter.py — encrypt on save**

Open `backend/app/api/mail_reporter.py`. Find `create_mailbox` and `update_mailbox` endpoints. Add encryption around the password field before it is written to the DB.

Find the import block at the top and add:
```python
from app.core.encryption import encrypt, decrypt
```

In `create_mailbox` (around where `MailboxConfig` is instantiated), before `db.add(mailbox)`:
```python
# Encrypt password before storing
if mailbox.password:
    mailbox.password = encrypt(mailbox.password)
```

In the response serialization of any endpoint that returns mailbox data, ensure `password` is **never** included in the response. Check the response schema `MailboxConfigResponse` in `schemas.py` — if it includes `password`, remove that field:
```python
# In schemas.py — MailboxConfigResponse must NOT include password
class MailboxConfigResponse(BaseOrmModel):
    id: int
    email: str
    # password intentionally omitted
    subject_filter: Optional[str] = None
    telegram_target: Optional[str] = None
    enabled: bool
    last_poll_at: Optional[datetime] = None
    last_error: Optional[str] = None
    monitor_since: Optional[date] = None
```

In `update_mailbox`, when `password` is in the update payload:
```python
if req.password:
    mailbox.password = encrypt(req.password)
```

- [ ] **Step 6: Update mail_reporter_service.py — decrypt before connecting**

Open `backend/app/services/mail_reporter_service.py`. Find where the IMAP connection is opened (look for `imaplib.IMAP4_SSL` or `imapclient`). Add decrypt before the password is used:

```python
from app.core.encryption import decrypt

# Before IMAP login — decrypt the stored password
plain_password = decrypt(mb.password)
# Use plain_password in imap.login(mb.email, plain_password)
```

- [ ] **Step 7: Write a migration for existing plaintext passwords**

Add this to the `run_migrations()` function in `backend/app/main.py` to re-encrypt any existing plaintext passwords on first startup:

```python
async def _migrate_imap_passwords():
    """One-time migration: encrypt any plaintext IMAP passwords."""
    from app.core.encryption import encrypt, decrypt
    from cryptography.fernet import InvalidToken
    from app.core.database import AsyncSessionFactory
    from app.models.models import MailboxConfig

    async with AsyncSessionFactory() as db:
        result = await db.execute(select(MailboxConfig))
        for mb in result.scalars().all():
            if not mb.password:
                continue
            try:
                decrypt(mb.password)  # Already encrypted — skip
            except (InvalidToken, Exception):
                mb.password = encrypt(mb.password)  # Plaintext — encrypt it
        await db.commit()
    logger.info("IMAP password migration complete")
```

Call `await _migrate_imap_passwords()` in the `lifespan` function, after `await run_migrations()`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/core/encryption.py backend/app/api/mail_reporter.py \
        backend/app/services/mail_reporter_service.py backend/app/main.py \
        backend/app/schemas/schemas.py backend/tests/test_encryption.py
git commit -m "security: encrypt IMAP passwords at rest using Fernet"
```

---

### Task A4: Rate-limit the token refresh endpoint

**Problem:** `/api/auth/refresh` has no rate limiting. An attacker can try refresh tokens at unlimited speed.
**File:** `backend/app/api/auth.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_auth_rate_limit.py
import pytest

async def test_refresh_rate_limited(client):
    """Hammering refresh endpoint should eventually get 429."""
    responses = []
    for _ in range(25):
        resp = await client.post("/api/auth/refresh", json={"refresh_token": "invalid"})
        responses.append(resp.status_code)
    # Should see at least one 429 after repeated attempts
    assert 429 in responses
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_auth_rate_limit.py -v
```
Expected: FAIL — only 401s, never 429.

- [ ] **Step 3: Read auth.py to find the existing rate-limiter pattern**

```bash
cat backend/app/api/auth.py
```
Note how `_login_attempts` dict + `_max_login_attempts` are used on the login route. You will mirror this pattern.

- [ ] **Step 4: Add refresh rate-limiter to auth.py**

At the top of the file, near the existing `_login_attempts` dict, add:
```python
_refresh_attempts: dict[str, list[float]] = {}
_MAX_REFRESH_PER_MIN = 20  # max 20 refresh attempts per IP per minute
```

At the start of the `refresh_token` endpoint handler, add:
```python
import time as _time

client_ip = request.client.host if request.client else "unknown"
now = _time.time()
window = _refresh_attempts.setdefault(client_ip, [])
# Drop attempts older than 60 seconds
_refresh_attempts[client_ip] = [t for t in window if now - t < 60]
if len(_refresh_attempts[client_ip]) >= _MAX_REFRESH_PER_MIN:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many refresh attempts. Wait 60 seconds.",
    )
_refresh_attempts[client_ip].append(now)
```

Also add `request: Request` to the function signature if not already there:
```python
async def refresh_token(body: RefreshRequest, request: Request, db: AsyncSession = Depends(get_db)):
```

- [ ] **Step 5: Run tests**

```bash
cd backend && pytest tests/test_auth_rate_limit.py -v
```
Expected: PASSED

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/auth.py backend/tests/test_auth_rate_limit.py
git commit -m "security: rate-limit token refresh endpoint (20/min per IP)"
```

---

### Task A5: Add security response headers middleware

**Problem:** No `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` headers. Browsers have no guidance on content handling.
**File:** `backend/app/main.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_security_headers.py
import pytest

async def test_security_headers_present(client):
    resp = await client.get("/api/health")
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("x-frame-options") == "DENY"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_security_headers.py -v
```
Expected: FAIL — headers absent.

- [ ] **Step 3: Add middleware to main.py**

In `backend/app/main.py`, after the `CORSMiddleware` block, add:

```python
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "0"  # Disable legacy XSS filter (CSP is better)
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response

app.add_middleware(SecurityHeadersMiddleware)
```

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/test_security_headers.py -v
```
Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_security_headers.py
git commit -m "security: add X-Frame-Options, X-Content-Type-Options, Referrer-Policy headers"
```

---

### Task A6: Fix string role comparisons in schedule.py

**Problem:** Two locations in `schedule.py` use `user.role != "admin"` instead of `user.role != UserRole.ADMIN`. If the enum ever changes, these checks silently break.

**File:** `backend/app/api/schedule.py`

- [ ] **Step 1: Find the exact lines**

```bash
grep -n '"admin"' backend/app/api/schedule.py
```
Expected output: two lines with the string `"admin"`.

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_schedule_auth.py
import pytest
from app.models.models import UserRole

async def test_role_check_uses_enum(client):
    """Ensure schedule endpoints use enum-based role checks (code audit)."""
    import ast, pathlib
    src = pathlib.Path("app/api/schedule.py").read_text()
    # No string "admin" should appear in role comparisons
    assert '!= "admin"' not in src, "Use UserRole.ADMIN enum, not string 'admin'"
    assert '== "admin"' not in src, "Use UserRole.ADMIN enum, not string 'admin'"
```

- [ ] **Step 3: Run to confirm failure**

```bash
cd backend && pytest tests/test_schedule_auth.py -v
```
Expected: FAIL

- [ ] **Step 4: Fix schedule.py**

Open `backend/app/api/schedule.py`. Add to the imports if not already present:
```python
from app.models.models import UserRole
```

Find every occurrence of `user.role != "admin"` and `user.role == "admin"` and replace with:
```python
user.role != UserRole.ADMIN
user.role == UserRole.ADMIN
```

- [ ] **Step 5: Run tests**

```bash
cd backend && pytest tests/test_schedule_auth.py -v
```
Expected: PASSED

- [ ] **Step 6: Verify no other files have string role checks**

```bash
grep -rn '"admin"' backend/app/api/ --include="*.py"
```
If any results appear outside of string literals (e.g., display text), fix them too using the same pattern.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/schedule.py backend/tests/test_schedule_auth.py
git commit -m "security: replace string 'admin' role checks with UserRole.ADMIN enum"
```

---

### Task A7: Add request body size limit

**Problem:** No middleware limits request body size. A 500 MB JSON body would be accepted and parsed in memory.
**File:** `backend/app/main.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_body_limit.py
import pytest

async def test_large_body_rejected(client):
    """Payloads over 1 MB should be rejected with 413."""
    big_payload = "x" * (2 * 1024 * 1024)  # 2 MB
    resp = await client.post(
        "/api/auth/login",
        content=big_payload,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 413
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_body_limit.py -v
```
Expected: FAIL — currently returns 422 (Pydantic validation error), not 413.

- [ ] **Step 3: Add body size middleware to main.py**

```python
# In backend/app/main.py — add after imports

from starlette.types import ASGIApp, Receive, Send, Scope
from starlette.responses import Response

class LimitBodySizeMiddleware:
    """Reject requests whose Content-Length exceeds max_bytes."""
    MAX_BODY_BYTES = 1 * 1024 * 1024  # 1 MB

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            content_length = None
            for header_name, header_value in scope.get("headers", []):
                if header_name == b"content-length":
                    try:
                        content_length = int(header_value)
                    except ValueError:
                        pass
            if content_length is not None and content_length > self.MAX_BODY_BYTES:
                response = Response(
                    content='{"detail": "Request body too large"}',
                    status_code=413,
                    media_type="application/json",
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
```

Then add it to the app:
```python
app.add_middleware(LimitBodySizeMiddleware)
```

Note: Add this BEFORE `CORSMiddleware` so it runs outermost.

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/test_body_limit.py -v
```
Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_body_limit.py
git commit -m "security: reject request bodies larger than 1 MB"
```

---

## PHASE B — Code Consistency & Quality

> These tasks eliminate code duplication, dead patterns, and redundant fields. No behavior changes — pure refactoring.

---

### Task B1: Add BaseOrmModel — eliminate 17 repeated Config classes

**Problem:** 17+ Pydantic response schemas each repeat:
```python
class Config:
    from_attributes = True
```
**File:** `backend/app/schemas/schemas.py`

- [ ] **Step 1: Write the structural test**

```python
# backend/tests/test_schema_consistency.py
import pytest
import inspect
from app.schemas import schemas

def test_no_bare_config_classes():
    """All ORM-mapped response schemas must inherit BaseOrmModel, not repeat Config."""
    violations = []
    for name, obj in inspect.getmembers(schemas, inspect.isclass):
        if hasattr(obj, 'model_config') or not hasattr(obj, '__mro__'):
            continue
        # Check for inner Config class with from_attributes
        inner = getattr(obj, 'Config', None)
        if inner and getattr(inner, 'from_attributes', False):
            violations.append(name)
    assert violations == [], f"These schemas repeat Config manually: {violations}"
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_schema_consistency.py -v
```
Expected: FAIL listing 17 schemas.

- [ ] **Step 3: Add BaseOrmModel at the top of schemas.py**

Open `backend/app/schemas/schemas.py`. After the imports (around line 12), add:

```python
from pydantic import ConfigDict

class BaseOrmModel(BaseModel):
    """Base class for all SQLAlchemy ORM response schemas."""
    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 4: Replace all repeated Config classes**

For every schema that has:
```python
class Config:
    from_attributes = True
```

1. Change its parent from `BaseModel` to `BaseOrmModel`
2. Remove the `class Config:` block entirely

Example transformation:
```python
# Before:
class UserResponse(BaseModel):
    id: UUID
    username: str
    class Config:
        from_attributes = True

# After:
class UserResponse(BaseOrmModel):
    id: UUID
    username: str
```

Do this for every such class in schemas.py. The full list from the audit:
`UserResponse`, `GroupResponse`, `ShiftConfigResponse`, `ShiftResponse`, `TimeOffResponse`,
`ReminderResponse`, `NotificationResponse`, `ActivityLogResponse`, `TelegramChatResponse`,
`TelegramTemplateResponse`, `MailboxConfigResponse`, `EmailLogResponse`, `EmailCommentResponse`,
`MailRoutingRuleResponse`, `VPSAgentResponse`, `VPSAgentRegisterResponse`, `ContainerStateResponse`,
`AgentWithContainersResponse`, `ContainerCommandResponse`, `SystemSnapshotResponse`.

- [ ] **Step 5: Run all tests**

```bash
cd backend && pytest -v
```
Expected: all PASSED (no behavioral change, only inheritance restructure).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/schemas.py backend/tests/test_schema_consistency.py
git commit -m "refactor: add BaseOrmModel base class, remove 17 repeated Config blocks"
```

---

### Task B2: Apply get_or_404 throughout API modules

**Problem:** 42+ locations manually do `select → scalar_one_or_none → if not: raise 404`. The `get_or_404` helper already exists in `deps.py` but is unused.

**Files:** All files in `backend/app/api/` (auth, users, groups, schedule, reminders, notifications, admin_config, mail_reporter, containers)

- [ ] **Step 1: Write the structural test**

```python
# In backend/tests/test_schema_consistency.py (add to existing file)

def test_get_or_404_used_consistently():
    """API modules must not implement manual 404 patterns inline."""
    import pathlib, re
    api_dir = pathlib.Path("app/api")
    # Pattern: scalar_one_or_none() immediately followed by if not
    pattern = re.compile(
        r'scalar_one_or_none\(\).*?\n\s+if not \w+.*?raise HTTPException.*?404',
        re.DOTALL
    )
    violations = []
    for f in api_dir.glob("*.py"):
        src = f.read_text()
        if pattern.search(src):
            violations.append(f.name)
    assert violations == [], f"These files still use manual 404 patterns: {violations}"
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_schema_consistency.py::test_get_or_404_used_consistently -v
```
Expected: FAIL

- [ ] **Step 3: Update get_or_404 import in each API file**

For each of the API files listed, ensure the import includes `get_or_404`:

```python
from app.core.deps import get_current_user, require_admin, get_or_404
```

- [ ] **Step 4: Replace the pattern in each file**

For each occurrence of:
```python
result = await db.execute(select(SomeModel).where(SomeModel.id == some_id))
obj = result.scalar_one_or_none()
if not obj:
    raise HTTPException(status_code=404, detail="Not found")
```

Replace with:
```python
obj = await get_or_404(db, SomeModel, some_id)
```

Note: `get_or_404` uses `db.get(model, pk)` which works for primary key lookups. For lookups on non-PK fields (e.g. `where(User.username == x)`), keep the manual pattern — `get_or_404` is only for PK lookups.

Work through files in this order (smallest to largest):
1. `backend/app/api/groups.py`
2. `backend/app/api/reminders.py`
3. `backend/app/api/notifications.py`
4. `backend/app/api/admin_config.py`
5. `backend/app/api/users.py`
6. `backend/app/api/schedule.py`
7. `backend/app/api/mail_reporter.py`
8. `backend/app/api/containers.py`

- [ ] **Step 5: Run all tests after each file**

```bash
cd backend && pytest -v
```
Expected: all PASSED after each file.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/ backend/tests/test_schema_consistency.py
git commit -m "refactor: replace 42 manual 404 patterns with get_or_404 helper"
```

---

### Task B3: Remove redundant EmailLog.is_solved field

**Problem:** `EmailLog` has both `status: VARCHAR` (unchecked/solved/on_pause/blocked) AND `is_solved: BOOLEAN`. These can drift out of sync. `status` is the authoritative field.

**Files:**
- `backend/app/models/models.py`
- `backend/app/schemas/schemas.py`
- `backend/app/api/mail_reporter.py`
- `backend/app/main.py` (migration to backfill status from is_solved)

- [ ] **Step 1: Write the structural test**

```python
# backend/tests/test_model_consistency.py
def test_email_log_no_is_solved():
    """EmailLog must not have is_solved — use status field instead."""
    from app.models.models import EmailLog
    assert not hasattr(EmailLog, 'is_solved'), \
        "is_solved is redundant with status field — remove it"
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_model_consistency.py -v
```
Expected: FAIL

- [ ] **Step 3: Add a one-time data migration in main.py**

Before removing the column, backfill: if `is_solved == True` and `status == 'unchecked'`, set `status = 'solved'`. Add to `run_migrations()` in `main.py`:

```python
# Backfill is_solved → status for any rows that used old boolean
"UPDATE email_logs SET status = 'solved' WHERE is_solved = 1 AND status = 'unchecked'",
```

- [ ] **Step 4: Remove is_solved from the ORM model**

In `backend/app/models/models.py`, find the `EmailLog` class and remove the line:
```python
is_solved = Column(Boolean, default=False)
```

SQLite doesn't support DROP COLUMN on older versions. The column stays in the DB but the ORM ignores it — this is safe. To explicitly drop it (SQLite 3.35+):
```python
# Add to run_migrations():
"ALTER TABLE email_logs DROP COLUMN is_solved",
```

- [ ] **Step 5: Remove is_solved from schemas**

In `backend/app/schemas/schemas.py`, find `EmailLogResponse` and remove `is_solved` field. Also check `EmailLogUpdate` or any schema that sets it.

Search for all occurrences:
```bash
grep -n "is_solved" backend/app/schemas/schemas.py backend/app/api/mail_reporter.py
```
Remove each occurrence.

- [ ] **Step 6: Run tests**

```bash
cd backend && pytest -v
```
Expected: all PASSED

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/models.py backend/app/schemas/schemas.py \
        backend/app/api/mail_reporter.py backend/app/main.py \
        backend/tests/test_model_consistency.py
git commit -m "refactor: remove redundant EmailLog.is_solved, use status field as truth"
```

---

### Task B4: Fix migration error swallowing — log unexpected errors

**Problem:** `run_migrations()` silently swallows ALL exceptions, not just "column already exists". Genuine DB errors go unnoticed.

**File:** `backend/app/main.py`

- [ ] **Step 1: Find the current migration error handler**

```bash
grep -n "except Exception" backend/app/main.py
```

- [ ] **Step 2: Replace bare except with specific handling**

Find:
```python
        except Exception:
            pass  # Column already exists — safe to ignore
```

Replace with:
```python
        except Exception as e:
            msg = str(e).lower()
            # Additive migrations: "already exists" / "duplicate column" are expected
            if "already exists" not in msg and "duplicate column" not in msg:
                logger.warning("Migration step may have failed: %s — stmt: %s", e, stmt[:80])
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "refactor: log unexpected migration errors instead of silently swallowing"
```

---

### Task B5: Fix silent JSON parse failures in containers.py

**Problem:** Two `except Exception: pass` blocks in `_parse_telegraf_batch` silently discard malformed JSON without logging.
**File:** `backend/app/api/containers.py`

- [ ] **Step 1: Find the locations**

```bash
grep -n "except Exception: pass" backend/app/api/containers.py
```

- [ ] **Step 2: Add logging to each**

Find each occurrence in `_parse_telegraf_batch` and replace:
```python
except Exception: pass
```
With:
```python
except Exception as e:
    logger.debug("Failed to parse telegraf field '%s': %s", name, e)
```

`debug` level is correct here (noisy metric data, not an application error).

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/containers.py
git commit -m "refactor: log (at DEBUG) JSON parse failures in telegraf batch parser"
```

---

## PHASE C — Production Readiness & Stability

> Infrastructure hardening: health checks, structured logging, Docker improvements, missing DB indexes.

---

### Task C1: Enhance /api/health with database connectivity check

**Problem:** `GET /api/health` returns `{"status": "ok"}` even if the database is unreachable. Load balancers and Docker health checks can't distinguish a healthy app from a broken one.

**File:** `backend/app/main.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_health.py (update existing file)
async def test_health_includes_db_check(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "db" in data  # Must include db check result
    assert data["db"] == "ok"
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest tests/test_health.py::test_health_includes_db_check -v
```
Expected: FAIL — no "db" key in response.

- [ ] **Step 3: Update the health endpoint**

In `backend/app/main.py`, replace:
```python
@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}
```

With:
```python
from sqlalchemy import text

@app.get("/api/health")
async def health(db: AsyncSession = Depends(get_db)):
    db_status = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except Exception as e:
        logger.error("Health check: DB unreachable: %s", e)
        db_status = "error"
    status_code = 200 if db_status == "ok" else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": "ok" if db_status == "ok" else "degraded",
                 "db": db_status,
                 "version": settings.APP_VERSION},
    )
```

Add required import at top of file if not already present:
```python
from app.core.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
```

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/test_health.py -v
```
Expected: all PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_health.py
git commit -m "ops: /api/health now checks DB connectivity, returns 503 if unreachable"
```

---

### Task C2: Add structured logging with rotation

**Problem:** `logging.basicConfig(level=logging.INFO)` — no timestamps, no rotation, no JSON format. Difficult to parse in production and risks filling disk.

**Files:**
- Create: `backend/app/core/logging_config.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create logging_config.py**

```python
# backend/app/core/logging_config.py
"""
Structured logging setup.
- Log to stderr in development (human-readable)
- Rotation: 10 MB max per file, keep 5 backups
- Format includes timestamp, level, logger name, and message
"""
import logging
import logging.handlers
import os
import sys

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
LOG_DIR = os.environ.get("LOG_DIR", "")  # Empty = log to stderr only


def configure_logging() -> None:
    fmt = logging.Formatter(
        fmt="%(asctime)s [%(levelname)-8s] %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)

    # Always log to stderr
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setFormatter(fmt)
    root.addHandler(stderr_handler)

    # Optionally also log to rotating files
    if LOG_DIR:
        os.makedirs(LOG_DIR, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            filename=os.path.join(LOG_DIR, "portal.log"),
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)

    # Silence noisy third-party loggers
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("aiosqlite").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
```

- [ ] **Step 2: Replace basicConfig in main.py**

In `backend/app/main.py`, remove:
```python
logging.basicConfig(level=logging.INFO)
```

Add at the top (after imports):
```python
from app.core.logging_config import configure_logging
configure_logging()
```

- [ ] **Step 3: Update docker-compose.yml to set LOG_DIR**

In `docker-compose.yml`, under the `api` service `environment:` block, add:
```yaml
LOG_DIR: /app/data/logs
```

And add to volumes:
```yaml
volumes:
  - ./data:/app/data
```
(already present — just ensure `data/logs/` can be created within it)

- [ ] **Step 4: Verify app still starts**

```bash
cd backend && python3 -c "from app.core.logging_config import configure_logging; configure_logging(); print('OK')"
```
Expected: prints `OK` without error.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/logging_config.py backend/app/main.py docker-compose.yml
git commit -m "ops: replace basicConfig with structured rotating log handler"
```

---

### Task C3: Add Docker health checks

**Problem:** `docker-compose.yml` has no `healthcheck` for either service. Docker can't restart unhealthy containers automatically.

**File:** `docker-compose.yml`

- [ ] **Step 1: Read the current docker-compose.yml**

```bash
cat docker-compose.yml
```

- [ ] **Step 2: Add health checks to both services**

Find the `api` service definition and add:
```yaml
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8000/api/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

Find the `frontend` service definition and add:
```yaml
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:80/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    depends_on:
      api:
        condition: service_healthy
```

The `depends_on: api: condition: service_healthy` ensures the frontend only starts once the API is healthy.

- [ ] **Step 3: Verify compose file is valid**

```bash
docker-compose config --quiet && echo "Compose config valid"
```
Expected: `Compose config valid`

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "ops: add Docker healthchecks for api and frontend services"
```

---

### Task C4: Add missing database indexes for query performance

**Problem:** Three frequently-queried columns have no explicit index, which matters as data grows: `EmailLog.mailbox_id`, `EmailLog.created_at`, `Reminder.remind_at`.

**File:** `backend/app/models/models.py`

- [ ] **Step 1: Find the EmailLog and Reminder model definitions**

```bash
grep -n "class EmailLog\|class Reminder" backend/app/models/models.py
```

- [ ] **Step 2: Add Index definitions**

In the `EmailLog` model, after the existing column definitions, add:
```python
from sqlalchemy import Index

# At bottom of EmailLog class or as table_args:
__table_args__ = (
    Index("ix_email_logs_mailbox_id", "mailbox_id"),
    Index("ix_email_logs_created_at", "created_at"),
    Index("ix_email_logs_status", "status"),
)
```

In the `Reminder` model:
```python
__table_args__ = (
    Index("ix_reminders_remind_at", "remind_at"),
    Index("ix_reminders_user_id", "user_id"),
)
```

In the `Shift` model (frequently queried by date and user):
```python
__table_args__ = (
    Index("ix_shifts_date", "date"),
    Index("ix_shifts_user_id", "user_id"),
)
```

- [ ] **Step 3: Add SQLite migrations for existing databases**

In `backend/app/main.py`, in the `migrations` list inside `run_migrations()`, add at the end:
```python
"CREATE INDEX IF NOT EXISTS ix_email_logs_mailbox_id ON email_logs(mailbox_id)",
"CREATE INDEX IF NOT EXISTS ix_email_logs_created_at ON email_logs(created_at)",
"CREATE INDEX IF NOT EXISTS ix_email_logs_status ON email_logs(status)",
"CREATE INDEX IF NOT EXISTS ix_reminders_remind_at ON reminders(remind_at)",
"CREATE INDEX IF NOT EXISTS ix_reminders_user_id ON reminders(user_id)",
"CREATE INDEX IF NOT EXISTS ix_shifts_date ON shifts(date)",
"CREATE INDEX IF NOT EXISTS ix_shifts_user_id ON shifts(user_id)",
```

(`CREATE INDEX IF NOT EXISTS` is idempotent — safe to re-run.)

- [ ] **Step 4: Run all tests**

```bash
cd backend && pytest -v
```
Expected: all PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/models.py backend/app/main.py
git commit -m "perf: add missing indexes on email_logs, reminders, and shifts tables"
```

---

### Task C5: Wrap APScheduler jobs with exception guards

**Problem:** If an APScheduler job raises an unhandled exception, APScheduler logs it but the job may stop firing. Adding try/except guards ensures jobs keep running and errors are logged clearly.

**Files:**
- `backend/app/workers/reminder_worker.py`
- `backend/app/workers/shift_notification_worker.py`
- `backend/app/services/telegram_service.py` (poll_telegram_updates)
- `backend/app/services/mail_reporter_service.py` (check_all_mailboxes)
- `backend/app/api/containers.py` (`check_vps_offline` already has try/except — verify)

- [ ] **Step 1: Read reminder_worker.py**

```bash
cat backend/app/workers/reminder_worker.py
```

- [ ] **Step 2: Wrap top-level job function**

For each worker, the top-level job function (the one added to the scheduler) should have a try/except that logs the error but doesn't re-raise, so APScheduler reschedules the next interval:

```python
# Pattern for every job function:
import logging
logger = logging.getLogger(__name__)

async def check_and_fire_reminders():
    try:
        await _do_check_and_fire_reminders()
    except Exception as exc:
        logger.exception("check_and_fire_reminders crashed: %s", exc)


async def _do_check_and_fire_reminders():
    # ... existing implementation ...
```

Apply this wrapping pattern to:
- `reminder_worker.py`: wrap `check_and_fire_reminders`
- `shift_notification_worker.py`: wrap the main job function
- `telegram_service.py`: wrap `poll_telegram_updates`
- `mail_reporter_service.py`: wrap `check_all_mailboxes`
- `containers.py`: `check_vps_offline` already has this — verify it's correct

- [ ] **Step 3: Commit**

```bash
git add backend/app/workers/ backend/app/services/telegram_service.py \
        backend/app/services/mail_reporter_service.py
git commit -m "stability: wrap all APScheduler jobs with exception guards to prevent silent stops"
```

---

### Task C6: Validate CORS_ORIGINS in production

**Problem:** Default `CORS_ORIGINS` contains `localhost` origins. If env var not set in production, any local origin can call the API.

**File:** `backend/app/core/config.py`

- [ ] **Step 1: Add a production CORS warning**

In `backend/app/core/config.py`, in the `Settings` class, add:

```python
@field_validator("CORS_ORIGINS")
@classmethod
def warn_if_localhost_in_production(cls, v: str) -> str:
    # Only warn — don't block, since developers need localhost
    import os, logging
    _log = logging.getLogger("config")
    if os.environ.get("ENVIRONMENT", "development").lower() == "production":
        if "localhost" in v or "127.0.0.1" in v:
            _log.warning(
                "CORS_ORIGINS contains localhost/127.0.0.1 in production mode. "
                "Set CORS_ORIGINS to your actual frontend domain."
            )
    return v
```

Add to `.env.example`:
```
# In production, set this to your actual frontend domain:
# CORS_ORIGINS=https://your-portal.example.com
ENVIRONMENT=development
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/core/config.py .env.example
git commit -m "ops: warn when CORS_ORIGINS contains localhost in production mode"
```

---

## Post-Execution Checklist

After all tasks are complete, verify end-to-end:

- [ ] `cd backend && pytest -v` — all tests pass
- [ ] `docker-compose up -d --build` — both services start healthy
- [ ] `docker-compose ps` — both services show `(healthy)` status
- [ ] `curl http://localhost:8000/api/health` — returns `{"status":"ok","db":"ok",...}`
- [ ] `curl -X POST http://localhost:8000/api/auth/login -d '{}' -H 'Content-Type: application/json'` — returns 422 (not 500)
- [ ] Verify IMAP mailbox passwords are encrypted: `sqlite3 data/portal.db "SELECT password FROM mailbox_configs LIMIT 1;"` — should show base64-looking string, not plaintext
- [ ] Verify security headers: `curl -I http://localhost:8000/api/health` — should show `x-content-type-options: nosniff`
- [ ] `git log --oneline` — confirm all commits are present with descriptive messages

---

## Summary of Changes

| Phase | Tasks | Key Outcome |
|-------|-------|-------------|
| **A — Security** | A1–A7 | Test infra, secret validation, IMAP encryption, rate limiting, security headers, role enum fixes, body size limit |
| **B — Consistency** | B1–B5 | BaseOrmModel DRY, get_or_404 applied everywhere, is_solved removed, error handling fixed |
| **C — Production** | C1–C6 | DB health check, structured logging + rotation, Docker healthchecks, DB indexes, job guards, CORS validation |

**Files modified:** ~15 backend files, `docker-compose.yml`, `.env.example`
**Files created:** `backend/app/core/encryption.py`, `backend/app/core/logging_config.py`, `backend/tests/` (6 test files)
**Files deleted:** none
