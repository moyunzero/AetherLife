from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[3]
_ROOT_ENV = _REPO_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ROOT_ENV) if _ROOT_ENV.is_file() else ".env",
        extra="ignore",
    )

    redis_url: str | None = None
    database_url: str | None = None
    game_server_url: str = "http://127.0.0.1:2567"
    internal_worker_token: str | None = None

    llm_provider: str = "zhipu"
    llm_model: str = "glm-4.7-flash"
    # Optional pin for NPC bind_tools (empty = LLM_MODEL only); see LLM_MODEL_NPC env
    llm_model_npc: str | None = None
    llm_model_fallbacks: str = ""
    llm_provider_fallback: str | None = None
    llm_provider_reflect: str = "agnes"
    llm_model_reflect: str = "agnes-2.0-flash"
    llm_provider_lore: str | None = None
    llm_model_lore_t1: str | None = None
    llm_model_lore_t0: str | None = None

    openrouter_api_key: str | None = None
    openrouter_api_key_2: str | None = None
    groq_api_key: str | None = None
    agnes_api_key: str | None = None
    zhipu_api_key: str | None = None
    # When lore primary fails (429/quota/auth/network), try groq|agnes|openrouter|zhipu
    llm_provider_lore_fallback: str | None = None

    llm_mock: bool = False
    reflect_every_n: int = 5
    summarize_threshold: int = 100
    summarize_batch_size: int = 50


def get_settings() -> Settings:
    return Settings()
