"""Security: JWT tokens, password hashing, OTP verification."""
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import jwt, JWTError
from passlib.context import CryptContext
import pyotp
import qrcode
import qrcode.image.svg
import io
import base64
from app.core.config import get_settings

settings = get_settings()

# Password hashing with bcrypt
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# JWT Tokens
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    from app.core.dynamic_settings import eff
    to_encode = data.copy()
    minutes = eff("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES, cast=int)
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=minutes))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict) -> str:
    from app.core.dynamic_settings import eff
    to_encode = data.copy()
    days = eff("JWT_REFRESH_TOKEN_EXPIRE_DAYS", settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS, cast=int)
    expire = datetime.now(timezone.utc) + timedelta(days=days)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


# OTP (TOTP)
def generate_otp_secret() -> str:
    return pyotp.random_base32()


def get_otp_uri(secret: str, username: str) -> str:
    from app.core.dynamic_settings import eff
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name=eff("OTP_ISSUER", settings.OTP_ISSUER))


def generate_otp_qr_base64(secret: str, username: str) -> str:
    uri = get_otp_uri(secret, username)
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage)
    buffer = io.BytesIO()
    img.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def verify_otp(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=settings.OTP_VALID_WINDOW)
