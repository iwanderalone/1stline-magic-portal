from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    TELEGRAM_BOT_TOKEN: str = ""
    POLL_INTERVAL: int = 30
    TIMEZONE: str = "UTC"
    LOG_LEVEL: str = "INFO"
    CONFIG_PATH: str = "config.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
