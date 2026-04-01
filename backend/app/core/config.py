"""Application configuration with security best practices."""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    # App
    APP_NAME: str = "Support Portal"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"

    # Database — defaults to SQLite (file-based, zero-config)
    DATABASE_URL: str = "sqlite+aiosqlite:///./portal.db"

    # JWT
    JWT_SECRET: str = "change-me-use-openssl-rand-hex-64"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_strong(cls, v: str) -> str:
        """Reject weak or placeholder SECRET_KEY values."""
        weak_patterns = ["change-me", "change_me", "changeme", "example", "placeholder"]
        if len(v) < 32:
            raise ValueError(
                "SECRET_KEY must be at least 32 characters. Generate with: openssl rand -hex 32"
            )
        if any(p in v.lower() for p in weak_patterns):
            raise ValueError(
                "SECRET_KEY looks like a default placeholder. Generate with: openssl rand -hex 32"
            )
        return v

    @field_validator("JWT_SECRET")
    @classmethod
    def jwt_secret_must_be_strong(cls, v: str) -> str:
        """Reject weak or placeholder JWT_SECRET values."""
        weak_patterns = ["change-me", "change_me", "changeme", "example", "placeholder"]
        if len(v) < 32:
            raise ValueError(
                "JWT_SECRET must be at least 32 characters. Generate with: openssl rand -hex 64"
            )
        if any(p in v.lower() for p in weak_patterns):
            raise ValueError(
                "JWT_SECRET looks like a default placeholder. Generate with: openssl rand -hex 64"
            )
        return v

    # OTP
    OTP_ISSUER: str = "SupportPortal"
    OTP_VALID_WINDOW: int = 1  # Allow 1 step before/after for clock drift

    # Telegram Bot
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""

    # Timezone used for shift times configured in the admin panel.
    # All shift start/end times are stored and interpreted in this timezone.
    # Users receive notifications with times converted to their own profile timezone.
    # Use any IANA timezone name, e.g. "Europe/Moscow", "Asia/Dubai", "UTC"
    PORTAL_TIMEZONE: str = "UTC"

    # CORS — comma-separated origins, e.g.:
    #   CORS_ORIGINS=https://portal.example.com,https://www.example.com
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    # Mail Reporter
    MAIL_IMAP_SERVER: str = "imap.yandex.com"
    MAIL_IMAP_PORT: int = 993
    MAIL_IMAP_TIMEOUT: int = 30
    MAIL_POLL_INTERVAL: int = 30          # seconds between email checks
    MAIL_DEFAULT_CHAT_ID: str = ""        # fallback Telegram chat_id if mailbox has no target
    MAIL_DEFAULT_THREAD_ID: str = ""      # fallback Telegram thread/topic id

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
