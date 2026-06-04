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

    llm_provider: str = "openrouter"
    # openrouter/free auto-picks an available free model; see openrouter.ai/models?q=free
    llm_model: str = "openrouter/free"
    llm_model_fallbacks: str = (
        "meta-llama/llama-3.2-3b-instruct:free,meta-llama/llama-3.3-70b-instruct:free"
    )
    llm_provider_reflect: str = "agnes"
    llm_model_reflect: str = "agnes-2.0-flash"

    openrouter_api_key: str | None = None
    groq_api_key: str | None = None
    agnes_api_key: str | None = None

    llm_mock: bool = False
    reflect_every_n: int = 5
    summarize_threshold: int = 100
    summarize_batch_size: int = 50


def get_settings() -> Settings:
    return Settings()
