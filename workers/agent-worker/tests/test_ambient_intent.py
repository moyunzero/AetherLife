import json

import httpx
import pytest

from src.graph.ambient_intent import (
    clear_join_vicinity_counts_for_tests,
    generate_ambient_intent,
    post_ambient_intent,
    run_ambient_intent_job,
    _fallback_intent,
    _normalize_intent,
)
from src.config import Settings


@pytest.fixture(autouse=True)
def _clear_join_counts():
    """
    Pytest autouse fixture that clears join-vicinity usage counts before and after each test.
    
    This fixture calls clear_join_vicinity_counts_for_tests() prior to yielding control to the test and again after the test finishes to reset shared daily counters.
    """
    clear_join_vicinity_counts_for_tests()
    yield
    clear_join_vicinity_counts_for_tests()


def _payload(**overrides):
    """
    Builds a default ambient-intent job payload and applies any provided overrides.
    
    Parameters:
        overrides (dict): Keys to merge into the default payload; values replace the corresponding defaults.
    
    Returns:
        payload (dict): A dictionary representing the ambient-intent job, defaulting to:
            {
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
        with any provided overrides merged into it.
    """
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


def test_run_ambient_intent_job_posts_to_game_server():
    settings = Settings(
        llm_mock=True,
        game_server_url="http://127.0.0.1:9",
        internal_worker_token="test-token",
    )
    payload = _payload()

    def handler(request: httpx.Request) -> httpx.Response:
        """
        Validate that the incoming request is a POST for the test NPC intent endpoint with expected JSON body fields and respond with HTTP 204.
        
        Expects the request URL path to end with "/internal/rooms/test-room/npc-intent" and the JSON body to contain:
        - npcId == "npc-1"
        - trigger == "segment_change"
        - intent.zoneId == "home-yard"
        
        Returns:
            httpx.Response: Response with status code 204.
        
        Raises:
            AssertionError: If any of the URL or JSON body expectations are not met.
        """
        assert request.url.path.endswith("/internal/rooms/test-room/npc-intent")
        body = json.loads(request.content.decode())
        assert body["npcId"] == "npc-1"
        assert body["trigger"] == "segment_change"
        assert body["intent"]["zoneId"] == "home-yard"
        return httpx.Response(204)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    run_ambient_intent_job(payload, settings=settings, client=client)
