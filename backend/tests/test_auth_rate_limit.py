import os
os.environ.setdefault("SECRET_KEY", "a" * 32)
os.environ.setdefault("JWT_SECRET", "b" * 64)

import pytest


async def test_refresh_rate_limited(client):
    """Hammering refresh with invalid tokens should eventually yield 429."""
    got_429 = False
    for _ in range(25):
        resp = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": "invalid.token.value"}
        )
        if resp.status_code == 429:
            got_429 = True
            break
    assert got_429, "Expected 429 after repeated refresh attempts, got none"


async def test_login_still_works_after_refresh_limit(client):
    """Login rate limiter must be independent from refresh rate limiter."""
    # Just verify the login endpoint still responds normally (not cross-contaminated)
    resp = await client.post(
        "/api/auth/login",
        json={"username": "nonexistent", "password": "wrong"}
    )
    # Should get 401 or 400, NOT 429 (different rate limiter)
    assert resp.status_code in (400, 401, 422)
