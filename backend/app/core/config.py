"""Application configuration with security best practices."""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    # App
    APP_NAME: str = "Viory IT Portal"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"

    # Database — PostgreSQL (asyncpg)
    DATABASE_URL: str = "postgresql+asyncpg://portal:portal@localhost:5432/portal"

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

    @field_validator("CORS_ORIGINS")
    @classmethod
    def warn_if_localhost_in_production(cls, v: str) -> str:
        import os, logging as _logging
        _log = _logging.getLogger("config")
        if os.environ.get("ENVIRONMENT", "development").lower() == "production":
            if "localhost" in v or "127.0.0.1" in v:
                _log.warning(
                    "CORS_ORIGINS contains localhost/127.0.0.1 in production mode. "
                    "Set CORS_ORIGINS to your actual frontend domain."
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
    OTP_ISSUER: str = "Viory IT Portal"
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

    # Zammad
    ZAMMAD_WEBHOOK_SECRET: str = ""   # optional — if set, validates X-Hub-Signature
    ZAMMAD_URL: str = ""              # e.g. https://tickets.example.com — used for startup sync and ticket links
    ZAMMAD_API_TOKEN: str = ""        # optional — enables startup sync when paired with ZAMMAD_URL
    ZAMMAD_SYNC_ON_STARTUP: bool = True
    # Ticket Telegram alerts (opened / open-overdue escalation / solved). Empty chat id disables them.
    ZAMMAD_TELEGRAM_CHAT_ID: str = ""
    ZAMMAD_TELEGRAM_THREAD_ID: str = ""

    # Grafana alert webhook. If a token is set, incoming webhooks must carry it
    # (Authorization: Bearer <token>). Empty = accept unauthenticated posts.
    GRAFANA_WEBHOOK_TOKEN: str = ""

    # AI assistant (Gemini). Empty key = assistant disabled.
    # Privacy boundary: only TEAM data (schedule, time-off, runbooks) is ever
    # sent to the model — never customer ticket/email content.
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-flash-latest"

    # Mailbox Backup tool (Tools section). Backs up a Yandex mailbox over IMAP
    # into a .tar.zst on S3-compatible storage. Empty S3 creds = tool disabled.
    S3_BUCKET: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_ENDPOINT_URL: str = "https://storage.yandexcloud.net"
    S3_REGION: str = "ru-central1"
    S3_STORAGE_CLASS: str = "GLACIER"
    S3_PREFIX: str = "Backups/Yandex Mailboxes"
    MAILBOX_BACKUP_IMAP_HOST: str = "imap.yandex.ru"
    MAILBOX_BACKUP_ZSTD_LEVEL: int = 10  # 19 is very slow in-container; 10 is a good tradeoff

    # Inventory (Tools section). Browse/create/edit — never delete — devices in
    # NetBox. Empty URL/token = section hidden/disabled.
    NETBOX_URL: str = ""            # e.g. https://netbox.example.com
    NETBOX_API_TOKEN: str = ""
    # Handover PDF generator (Tools section). Works standalone, no NetBox needed.
    HANDOVER_ASSIGNOR_NAME: str = "Darpo FZ LLC (DBA Viory)"

    # Mail Reporter
    MAIL_IMAP_SERVER: str = "imap.yandex.com"
    MAIL_IMAP_PORT: int = 993
    MAIL_IMAP_TIMEOUT: int = 30
    # Outbound SMTP (replies from the portal). Mailboxes reuse their IMAP credentials.
    # 587 = STARTTLS (465 is blocked by the VPS provider).
    MAIL_SMTP_SERVER: str = "smtp.yandex.com"
    MAIL_SMTP_PORT: int = 587
    MAIL_FROM_NAME: str = "Viory IT Support"
    MAIL_POLL_INTERVAL: int = 30          # seconds between email checks
    MAIL_DEFAULT_CHAT_ID: str = ""        # fallback Telegram chat_id if mailbox has no target
    MAIL_DEFAULT_THREAD_ID: str = ""      # fallback Telegram thread/topic id

    # Keycloak SSO (OIDC). Empty CLIENT_ID/SECRET = SSO login hidden/disabled —
    # local username/password + TOTP login is unaffected either way.
    KEYCLOAK_SERVER_URL: str = ""       # e.g. https://sso.example.com
    KEYCLOAK_REALM: str = ""
    KEYCLOAK_CLIENT_ID: str = ""
    KEYCLOAK_CLIENT_SECRET: str = ""
    KEYCLOAK_REDIRECT_URI: str = ""     # backend callback, e.g. https://portal.example.com/api/auth/sso/callback
    PORTAL_PUBLIC_URL: str = ""         # frontend base URL for the post-login redirect; falls back to first CORS_ORIGINS entry
    # AD/Keycloak group -> portal role. Group membership is the sole source of
    # truth for SSO access — no membership in any of these, no login.
    KEYCLOAK_ADMIN_GROUP: str = "g-app-itportal-admin"
    KEYCLOAK_MANAGER_GROUP: str = "g-app-itportal-manager"
    KEYCLOAK_ENGINEER_GROUP: str = "g-app-itportal-engineer"
    KEYCLOAK_GROUPS_CLAIM: str = "groups"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
