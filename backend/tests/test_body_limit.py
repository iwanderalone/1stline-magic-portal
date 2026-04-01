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
