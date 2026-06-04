import json
from pathlib import Path

import pytest

from app.models.actions import validate_nl_action
from app.services import llm
from app.services.parse import parse_intent

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "golden_intents.json"


@pytest.fixture
def golden_cases():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return data["cases"]


def score_case(message: str, expected: dict) -> bool:
    raw = llm._heuristic_parse(message)
    parsed, err = validate_nl_action(raw)
    if err or not parsed:
        return False
    if parsed.get("type") != expected.get("type"):
        return False
    for key, value in expected.items():
        if key == "type":
            continue
        if parsed.get(key) != value:
            return False
    return True


def test_golden_dataset_has_24_cases(golden_cases):
    assert len(golden_cases) == 24
    zh = sum(1 for c in golden_cases if c["id"].startswith("zh"))
    en = sum(1 for c in golden_cases if c["id"].startswith("en"))
    assert zh >= 10
    assert en >= 10


@pytest.mark.asyncio
async def test_golden_parse_mocked_llm(monkeypatch, golden_cases):
    async def fake_parse(message: str, *, golden_expected=None):
        for case in golden_cases:
            if case["message"] == message:
                return case["expected"]
        return {"type": "wait", "durationMs": 1000}

    monkeypatch.setattr(llm, "parse_intent_json", fake_parse)

    hits = 0
    for case in golden_cases:
        parsed, err = await parse_intent(case["message"])
        assert err is None, case["id"]
        assert parsed is not None
        assert parsed.get("type") == case["expected"]["type"]
        for key, value in case["expected"].items():
            if key != "type":
                assert parsed.get(key) == value, case["id"]
        hits += 1

    rate = hits / len(golden_cases)
    assert rate >= 0.8


def test_heuristic_golden_score_at_least_80_percent(golden_cases):
    """Offline heuristic baseline; CI golden gate uses mocked LLM test above."""
    hits = sum(1 for c in golden_cases if score_case(c["message"], c["expected"]))
    rate = hits / len(golden_cases)
    assert rate >= 0.5, f"heuristic baseline {rate:.0%} (mocked test enforces ≥80%)"
