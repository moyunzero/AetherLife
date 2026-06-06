from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    game_server_url: str = "http://127.0.0.1:2567"
    internal_worker_token: str | None = None
    openrouter_api_key: str | None = None
    openrouter_api_key_2: str | None = None
    openai_api_key: str | None = None
    llm_mock: bool = False
    parse_timeout_s: float = 2.0


@lru_cache
def get_settings() -> Settings:
    import os

    settings = Settings()
    if os.getenv("LLM_MOCK") == "1":
        return settings.model_copy(update={"llm_mock": True})
    return settings
