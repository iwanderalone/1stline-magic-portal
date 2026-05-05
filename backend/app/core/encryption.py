"""
Fernet symmetric encryption for sensitive fields stored in the database.
Key is derived deterministically from SECRET_KEY — no separate key storage needed.
WARNING: changing SECRET_KEY will make existing ciphertext unreadable.
"""
import base64
import hashlib
from cryptography.fernet import Fernet
from app.core.config import get_settings


def _get_fernet() -> Fernet:
    settings = get_settings()
    raw = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    """Encrypt a string. Returns a URL-safe base64 Fernet token."""
    if not plaintext:
        return plaintext
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a Fernet token. Raises cryptography.fernet.InvalidToken on bad input."""
    if not ciphertext:
        return ciphertext
    return _get_fernet().decrypt(ciphertext.encode()).decode()
