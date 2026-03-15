"""Application configuration with security best practices."""
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    # App
    APP_NAME: str = "Support Portal"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"

    # Database — defaults to SQLite (file-based, zero-config)
    DATABASE_URL: str = "sqlite+aiosqlite:///./portal.db"

    # JWT
    JWT_SECRET: str = "change-me-use-openssl-rand-hex-64"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # OTP
    OTP_ISSUER: str = "SupportPortal"
    OTP_VALID_WINDOW: int = 1  # Allow 1 step before/after for clock drift

    # Telegram Bot
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""

    # CORS — comma-separated origins in env var, e.g.:
    #   CORS_ORIGINS=https://portal.example.com,https://www.example.com
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors(cls, v: str | list) -> list[str]:
        if isinstance(v, list):
            return v
        return [o.strip() for o in v.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
