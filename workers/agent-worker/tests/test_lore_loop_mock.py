import os

import httpx
import pytest

from src.config import Settings
from src.graph.lore_loop import generate_lore_llm, run_lore_job, validate_lore


def test_mock_lore_matches_dominant_biome(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    settings = Settings(llm_mock=True)
    lore = generate_lore_llm({"dominantBiome": "scrub", "cx": 1, "cy": 0}, settings)
    validate_lore(lore, "scrub")
    assert lore["proceduralBiome"] == "scrub"
    assert lore["nameZh"]


def test_run_lore_job_posts_internal_route(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "1")
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:2567",
        internal_worker_token="test-token",
        llm_model_lore_t1="openrouter/free",
    )
    payload = {
        "jobId": "lore-default-1-0",
        "worldId": "default",
        "mapRoomId": "default",
        "cx": 1,
        "cy": 0,
        "dominantBiome": "meadow",
        "walkableRatio": 0.8,
        "modelTier": "T1",
    }
    posted: list[dict] = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"ok": True}

    class FakeClient:
        def post(self, url, *args, **kwargs):
            posted.append({"url": url, "json": kwargs.get("json")})
            return FakeResponse()

    run_lore_job(payload, settings=settings, client=FakeClient())  # type: ignore[arg-type]

    assert len(posted) == 1
    assert posted[0]["url"].endswith("/internal/world/default/chunks/1/0/lore")
    assert posted[0]["json"]["lore"]["proceduralBiome"] == "meadow"
    assert posted[0]["json"]["modelTier"] == "T1"


def test_validate_rejects_biome_mismatch():
    lore = {
        "nameZh": "测试",
        "flavorOneLine": "一行",
        "storyHook": "钩子",
        "proceduralBiome": "meadow",
        "moodTag": "静",
        "npcRumor": "传闻",
        "hiddenQuestSeed": "seed",
    }
    with pytest.raises(ValueError, match="mismatch"):
        validate_lore(lore, "scrub")
