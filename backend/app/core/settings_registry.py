"""Registry of admin-editable settings that override app/core/config.py env
defaults at runtime. Drives both the Admin > Settings API and frontend form.

Each entry:
  key              — matches a Settings field name in config.py
  category         — groups fields in the admin UI
  label            — human-readable field label
  type             — "str" | "int" | "bool"
  is_secret        — encrypted at rest, never echoed back to the client
  requires_restart — the running process only picks this up on next boot
                      (e.g. CORS middleware is configured once at app startup)
"""

SETTINGS_REGISTRY = [
    # ── App & Branding ──────────────────────────────────────────────
    {"key": "APP_NAME", "category": "App & Branding", "label": "App name", "type": "str", "requires_restart": True},
    {"key": "OTP_ISSUER", "category": "App & Branding", "label": "OTP issuer (shown in authenticator apps)", "type": "str"},
    {"key": "PORTAL_TIMEZONE", "category": "App & Branding", "label": "Portal timezone (IANA name)", "type": "str"},
    {"key": "PORTAL_PUBLIC_URL", "category": "App & Branding", "label": "Public frontend URL (SSO redirect fallback)", "type": "str"},
    {"key": "CORS_ORIGINS", "category": "App & Branding", "label": "CORS allowed origins (comma-separated)", "type": "str", "requires_restart": True},

    # ── Security & Sessions ─────────────────────────────────────────
    {"key": "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "category": "Security & Sessions", "label": "Access token lifetime (minutes)", "type": "int"},
    {"key": "JWT_REFRESH_TOKEN_EXPIRE_DAYS", "category": "Security & Sessions", "label": "Refresh token lifetime (days)", "type": "int"},

    # ── Mail Reporter ───────────────────────────────────────────────
    {"key": "MAIL_POLL_INTERVAL", "category": "Mail Reporter", "label": "IMAP poll interval (seconds)", "type": "int"},
    {"key": "MAIL_FROM_NAME", "category": "Mail Reporter", "label": "Outbound reply From name", "type": "str"},
    {"key": "MAIL_DEFAULT_CHAT_ID", "category": "Mail Reporter", "label": "Default Telegram chat ID", "type": "str"},
    {"key": "MAIL_DEFAULT_THREAD_ID", "category": "Mail Reporter", "label": "Default Telegram thread/topic ID", "type": "str"},

    # ── Telegram Bot ────────────────────────────────────────────────
    {"key": "TELEGRAM_BOT_TOKEN", "category": "Telegram Bot", "label": "Bot token", "type": "str", "is_secret": True},

    # ── Zammad ──────────────────────────────────────────────────────
    {"key": "ZAMMAD_API_TOKEN", "category": "Zammad", "label": "API token", "type": "str", "is_secret": True},
    {"key": "ZAMMAD_WEBHOOK_SECRET", "category": "Zammad", "label": "Webhook HMAC secret", "type": "str", "is_secret": True},
    {"key": "ZAMMAD_SYNC_ON_STARTUP", "category": "Zammad", "label": "Sync tickets on startup", "type": "bool", "requires_restart": True},
    {"key": "ZAMMAD_TELEGRAM_CHAT_ID", "category": "Zammad", "label": "Escalation Telegram chat ID", "type": "str"},
    {"key": "ZAMMAD_TELEGRAM_THREAD_ID", "category": "Zammad", "label": "Escalation Telegram thread/topic ID", "type": "str"},

    # ── Grafana ─────────────────────────────────────────────────────
    {"key": "GRAFANA_WEBHOOK_TOKEN", "category": "Grafana", "label": "Webhook bearer token", "type": "str", "is_secret": True},

    # ── Service Status ──────────────────────────────────────────────
    {"key": "PROMETHEUS_REMOTE_WRITE_TOKEN", "category": "Service Status", "label": "Prometheus remote_write bearer token", "type": "str", "is_secret": True},
    {"key": "STATUS_STALE_AFTER_SECONDS", "category": "Service Status", "label": "Mark a probe stale after (seconds)", "type": "int"},
    {"key": "STATUS_PRUNE_AFTER_HOURS", "category": "Service Status", "label": "Drop targets not pushed for (hours)", "type": "int"},
    {"key": "STATUS_GROUP_LABEL", "category": "Service Status", "label": "Label used to group targets into sections", "type": "str"},
    {"key": "STATUS_GROUP_ORDER", "category": "Service Status", "label": "Section order, comma-separated (unlisted groups follow alphabetically)", "type": "str"},

    # ── AI Assistant ────────────────────────────────────────────────
    {"key": "GEMINI_API_KEY", "category": "AI Assistant", "label": "Gemini API key", "type": "str", "is_secret": True},
    {"key": "GEMINI_MODEL", "category": "AI Assistant", "label": "Gemini model", "type": "str"},

    # ── Mailbox Backup (S3) ─────────────────────────────────────────
    {"key": "S3_ACCESS_KEY_ID", "category": "Mailbox Backup", "label": "S3 access key ID", "type": "str", "is_secret": True},
    {"key": "S3_SECRET_ACCESS_KEY", "category": "Mailbox Backup", "label": "S3 secret access key", "type": "str", "is_secret": True},
    {"key": "S3_STORAGE_CLASS", "category": "Mailbox Backup", "label": "S3 storage class", "type": "str"},
    {"key": "S3_PREFIX", "category": "Mailbox Backup", "label": "S3 key prefix", "type": "str"},
    {"key": "S3_REGION", "category": "Mailbox Backup", "label": "S3 region", "type": "str"},
    {"key": "MAILBOX_BACKUP_IMAP_HOST", "category": "Mailbox Backup", "label": "IMAP host to back up from", "type": "str"},
    {"key": "MAILBOX_BACKUP_ZSTD_LEVEL", "category": "Mailbox Backup", "label": "zstd compression level", "type": "int"},

    # ── Inventory (NetBox) ──────────────────────────────────────────
    {"key": "NETBOX_API_TOKEN", "category": "Inventory", "label": "NetBox API token", "type": "str", "is_secret": True},
    {"key": "HANDOVER_ASSIGNOR_NAME", "category": "Inventory", "label": "Handover assignor name", "type": "str"},

    # ── Keycloak SSO ────────────────────────────────────────────────
    {"key": "KEYCLOAK_SERVER_URL", "category": "Keycloak SSO", "label": "Server URL", "type": "str"},
    {"key": "KEYCLOAK_REALM", "category": "Keycloak SSO", "label": "Realm", "type": "str"},
    {"key": "KEYCLOAK_CLIENT_ID", "category": "Keycloak SSO", "label": "Client ID", "type": "str"},
    {"key": "KEYCLOAK_CLIENT_SECRET", "category": "Keycloak SSO", "label": "Client secret", "type": "str", "is_secret": True},
    {"key": "KEYCLOAK_REDIRECT_URI", "category": "Keycloak SSO", "label": "Redirect URI", "type": "str"},
    {"key": "KEYCLOAK_ADMIN_GROUP", "category": "Keycloak SSO", "label": "Admin group name", "type": "str"},
    {"key": "KEYCLOAK_MANAGER_GROUP", "category": "Keycloak SSO", "label": "Manager group name", "type": "str"},
    {"key": "KEYCLOAK_ENGINEER_GROUP", "category": "Keycloak SSO", "label": "Engineer group name", "type": "str"},
    {"key": "KEYCLOAK_GROUPS_CLAIM", "category": "Keycloak SSO", "label": "Groups claim name", "type": "str"},
]

SETTINGS_BY_KEY = {s["key"]: s for s in SETTINGS_REGISTRY}
