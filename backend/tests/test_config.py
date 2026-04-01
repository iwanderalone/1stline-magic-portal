import os
os.environ.setdefault("SECRET_KEY", "a" * 32)
os.environ.setdefault("JWT_SECRET", "b" * 64)

import pytest
from pydantic import ValidationError


def test_weak_secret_key_is_rejected():
    from app.core.config import Settings
    with pytest.raises((ValidationError, ValueError, RuntimeError)):
        Settings(SECRET_KEY="change-me-in-production-short", JWT_SECRET="b" * 64)


def test_short_secret_key_is_rejected():
    from app.core.config import Settings
    with pytest.raises((ValidationError, ValueError, RuntimeError)):
        Settings(SECRET_KEY="short", JWT_SECRET="b" * 64)


def test_weak_jwt_secret_is_rejected():
    from app.core.config import Settings
    with pytest.raises((ValidationError, ValueError, RuntimeError)):
        Settings(SECRET_KEY="a" * 32, JWT_SECRET="change-me-use-openssl")


def test_strong_secrets_are_accepted():
    from app.core.config import Settings
    # Should NOT raise
    s = Settings(SECRET_KEY="a" * 32, JWT_SECRET="b" * 64)
    assert s.SECRET_KEY == "a" * 32
    assert s.JWT_SECRET == "b" * 64
