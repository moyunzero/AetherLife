import json

import httpx
import pytest

from src.graph.ambient_intent import (
    NPC_DISPLAY_NAMES,
    clear_join_vicinity_counts_for_tests,
    generate_ambient_intent,
    post_ambient_intent,
    run_ambient_intent_job,
    _fallback_intent,
    _normalize_intent,
)
from src.council.constants import COUNCIL_NPC_IDS
from src.config import Settings


@pytest.fixture(autouse=True)
def _clear_join_counts():
    clear_join_vicinity_counts_for_tests()
    yield
    clear_join_vicinity_counts_for_tests()


def _payload(**overrides):
    base = {
        "jobId": "ambient-test-npc-1-segment_change-480",
        "roomId": "test-room",
        "npcId": "npc-1",
        "gameMinute": 480,
        "trigger": "segment_change",
        "segment": {
            "zoneId": "home-yard",
            "activityKey": "patrol",
            "mobility": "wander",
            "fromMinute": 480,
            "toMinute": 720,
        },
    }
    base.update(overrides)
    return base


def test_normalize_target_intent():
    raw = {
        "target": {"gx": 12, "gy": 8},
        "reasonZh": "去河边看看",
        "untilGameMinute": 720,
    }
    intent = _normalize_intent(raw, _payload(), Settings(llm_mock=True))
    assert intent["target"] == {"gx": 12, "gy": 8}
    assert intent["reasonZh"] == "去河边看看"
    assert intent["untilGameMinute"] == 720


def test_normalize_zone_intent():
    raw = {"zoneId": "village-plaza", "reasonZh": "逛广场", "untilGameMinute": 600}
    intent = _normalize_intent(raw, _payload(), Settings(llm_mock=True))
    assert intent["zoneId"] == "village-plaza"
    assert "target" not in intent


def test_join_vicinity_daily_cap():
    payload = _payload()
    settings = Settings(llm_mock=True)
    for _ in range(2):
        raw = {"zoneId": "home-yard", "reasonZh": "过来", "untilGameMinute": 720, "joinVicinity": True}
        intent = _normalize_intent(raw, payload, settings)
        assert intent.get("joinVicinity") is True
    raw = {"zoneId": "home-yard", "reasonZh": "再来", "untilGameMinute": 720, "joinVicinity": True}
    intent = _normalize_intent(raw, payload, settings)
    assert "joinVicinity" not in intent


def test_fallback_intent_uses_npc_motivation_not_activity_paraphrase():
    payload = _payload(segment={"zoneId": "beginning-fields@v1:orchard", "activityKey": "reading", "toMinute": 720})
    intent = _fallback_intent(payload)
    assert intent["reasonZh"] == "心里还惦记着件事"
    assert "看书" not in intent["reasonZh"]


def test_generate_mock_intent_reason_not_activity_paraphrase():
    settings = Settings(llm_mock=True)
    payload = _payload(segment={"zoneId": "beginning-fields@v1:orchard", "activityKey": "reading", "toMinute": 720})
    intent = generate_ambient_intent(payload, settings)
    assert "看书" not in intent["reasonZh"]


def test_generate_mock_intent():
    settings = Settings(llm_mock=True)
    intent = generate_ambient_intent(_payload(), settings)
    assert intent["zoneId"] == "home-yard"
    assert intent["reasonZh"] == "随便逛逛"
    assert intent["untilGameMinute"] == 720


def test_npc_display_names_cover_all_council_seats():
    assert set(NPC_DISPLAY_NAMES.keys()) == set(COUNCIL_NPC_IDS)
    assert NPC_DISPLAY_NAMES["npc-1"] == "莫玄虚"
    assert NPC_DISPLAY_NAMES["npc-4"] == "糖果"


def test_generate_uses_payload_npc_name_over_stale_dict():
    settings = Settings(llm_mock=True)
    payload = _payload(npcName="莫玄虚")
    intent = generate_ambient_intent(payload, settings)
    assert intent["zoneId"] == "home-yard"


def test_fallback_intent_npc_8_uses_seat_voice_not_npc_1():
    payload = _payload(
        npcId="npc-8",
        segment={"zoneId": "beginning-fields@v1:plaza", "activityKey": "patrol", "toMinute": 720},
    )
    intent = _fallback_intent(payload)
    assert intent["reasonZh"] == "出来走走顺便照看一下"
    assert intent["reasonZh"] != _fallback_intent(_payload(npcId="npc-1", segment=payload["segment"]))[
        "reasonZh"
    ]


def test_fallback_intent_npc_11_uses_seat_voice_not_npc_1():
    payload = _payload(
        npcId="npc-11",
        segment={"zoneId": "beginning-fields@v1:orchard", "activityKey": "reading", "toMinute": 720},
    )
    intent = _fallback_intent(payload)
    assert intent["reasonZh"] == "细节还得再抠一抠"
    assert intent["reasonZh"] != _fallback_intent(_payload(npcId="npc-1", segment=payload["segment"]))[
        "reasonZh"
    ]


def test_run_ambient_intent_job_posts_for_npc_8():
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:9",
        internal_worker_token="test-token",
    )
    payload = _payload(npcId="npc-8", jobId="ambient-test-npc-8-segment_change-480")
    seen_npc_ids: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/npc-intent/pending-clear"):
            return httpx.Response(204)
        body = json.loads(request.content.decode())
        seen_npc_ids.append(body["npcId"])
        assert body["npcId"] == "npc-8"
        return httpx.Response(204)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    run_ambient_intent_job(payload, settings=settings, client=client)
    assert seen_npc_ids == ["npc-8"]


def test_run_ambient_intent_job_posts_for_npc_11():
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:9",
        internal_worker_token="test-token",
    )
    payload = _payload(npcId="npc-11", jobId="ambient-test-npc-11-segment_change-480")
    seen_npc_ids: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/npc-intent/pending-clear"):
            return httpx.Response(204)
        body = json.loads(request.content.decode())
        seen_npc_ids.append(body["npcId"])
        assert body["npcId"] == "npc-11"
        return httpx.Response(204)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    run_ambient_intent_job(payload, settings=settings, client=client)
    assert seen_npc_ids == ["npc-11"]


def test_run_ambient_intent_job_posts_to_game_server():
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:9",
        internal_worker_token="test-token",
    )
    payload = _payload()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/internal/rooms/test-room/npc-intent")
        body = json.loads(request.content.decode())
        assert body["npcId"] == "npc-1"
        assert body["trigger"] == "segment_change"
        assert body["intent"]["zoneId"] == "home-yard"
        return httpx.Response(204)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    run_ambient_intent_job(payload, settings=settings, client=client)
