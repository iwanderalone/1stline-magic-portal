"""
Fernet symmetric encryption for sensitive fields stored in the database.

Key source: DATA_ENCRYPTION_KEY if set, else derived from SECRET_KEY
(legacy behavior, kept for zero-config backward compatibility). When
DATA_ENCRYPTION_KEY is set, encryption uses it exclusively but decryption
also accepts ciphertext still under the old SECRET_KEY-derived key via
MultiFernet, so existing encrypted rows (IMAP passwords, SSO refresh
tokens) keep working without a forced data migration.
"""
import base64
import hashlib
from cryptography.fernet import Fernet, MultiFernet
from app.core.config import get_settings


def _derive_key(secret: str) -> bytes:
    raw = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(raw)


def _get_fernet() -> MultiFernet:
    settings = get_settings()
    keys = []
    if settings.DATA_ENCRYPTION_KEY:
        keys.append(Fernet(_derive_key(settings.DATA_ENCRYPTION_KEY)))
    # Legacy key always included as a decrypt-only fallback (also the sole
    # key when DATA_ENCRYPTION_KEY is unset — identical to old behavior).
    keys.append(Fernet(_derive_key(settings.SECRET_KEY)))
    return MultiFernet(keys)


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
