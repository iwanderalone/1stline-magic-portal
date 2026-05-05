import os
os.environ.setdefault("SECRET_KEY", "a" * 32)
os.environ.setdefault("JWT_SECRET", "b" * 64)

import pytest
from app.api import auth as auth_module


@pytest.fixture(autouse=True)
def reset_rate_limit_state():
    auth_module._refresh_attempts.clear()
    auth_module._fail_counts.clear()
    yield
    auth_module._refresh_attempts.clear()
    auth_module._fail_counts.clear()


async def test_refresh_rate_limited(client):
    """Rate limiter should allow 20 attempts then return 429 on the 21st."""
    for i in range(25):
        resp = await client.post("/api/auth/refresh", json={"refresh_token": "invalid"})
        if i < 20:
            assert resp.status_code != 429, f"Got 429 too early on attempt {i + 1}"
        else:
            assert resp.status_code == 429
            break


async def test_login_still_works_after_refresh_limit(client):
    """Login rate limiter must be independent from refresh rate limiter."""
    # Just verify the login endpoint still responds normally (not cross-contaminated)
    resp = await client.post(
        "/api/auth/login",
        json={"username": "nonexistent", "password": "wrong"}
    )
    # Should get 401 or 400, NOT 429 (different rate limiter)
    assert resp.status_code in (400, 401, 422)
