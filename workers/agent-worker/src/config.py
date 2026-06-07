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
    # NPC fallback models (OpenRouter ids); empty = provider-specific default in factory
    llm_model_fallbacks: str = ""
    # NPC tool fallback when Zhipu fails — OpenRouter key rotation
    llm_provider_fallback: str = "openrouter"
    llm_model_openrouter_fallback: str = "openrouter/free"
    llm_provider_reflect: str = "agnes"
    llm_model_reflect: str = "agnes-2.0-flash"
    # Short JSON scoring — NVIDIA nano (fast); never Zhipu (concurrency=1)
    llm_provider_importance: str = "nvidia"
    llm_model_importance: str = "nvidia/llama-3.1-nemotron-nano-8b-v1"
    llm_provider_lore: str = "agnes"
    llm_model_lore_t1: str | None = None
    llm_model_lore_t0: str | None = None
    # High-RPM auxiliary (SiliconFlow L0 ~1000 RPM) — every speak / bulk paths
    llm_provider_social: str = "siliconflow"
    llm_model_social: str = "Qwen/Qwen3.5-4B"
    llm_provider_social_fallback: str = "agnes"
    llm_provider_summarize: str = "siliconflow"
    llm_model_summarize: str = "Qwen/Qwen3.5-4B"
    llm_provider_collective_refine: str = "siliconflow"
    llm_model_collective_refine: str = "Qwen/Qwen3.5-4B"
    # When SiliconFlow/Agnes auxiliary hits 429
    llm_provider_auxiliary_fallback: str = "agnes"

    openrouter_api_key: str | None = None
    openrouter_api_key_2: str | None = None
    groq_api_key: str | None = None
    agnes_api_key: str | None = None
    zhipu_api_key: str | None = None
    cerebras_api_key: str | None = None
    llm_model_cerebras: str = "gpt-oss-120b"
    siliconflow_api_key: str | None = None
    llm_model_siliconflow_fast: str = "Qwen/Qwen3.5-4B"
    llm_model_siliconflow_reason: str = "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B"
    nvidia_api_key: str | None = None
    llm_model_nvidia_fast: str = "qwen/qwen3-next-80b-a3b-instruct"
    llm_model_nvidia_large: str = "openai/gpt-oss-120b"
    llm_model_nvidia_nano: str = "nvidia/llama-3.1-nemotron-nano-8b-v1"
    llm_model_nvidia_lore: str = "nvidia/llama-3.3-nemotron-super-49b-v1.5"
    # Lore primary fails → NVIDIA narrative model (not Zhipu — concurrency=1)
    llm_provider_lore_fallback: str = "nvidia"
    # Optional quality slot when NVIDIA/OpenRouter exhausted (5 RPM — rare)
    llm_provider_lore_fallback_2: str | None = None

    llm_mock: bool = False
    reflect_every_n: int = 5
    summarize_threshold: int = 100
    summarize_batch_size: int = 50


def get_settings() -> Settings:
    return Settings()
