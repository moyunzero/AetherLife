import httpx

from src.http_json import safe_response_json


def test_safe_response_json_empty_body() -> None:
    res = httpx.Response(200, text="")
    assert safe_response_json(res) == {}


def test_safe_response_json_whitespace_only() -> None:
    res = httpx.Response(200, text="   \n  ")
    assert safe_response_json(res) == {}


def test_safe_response_json_invalid_json() -> None:
    res = httpx.Response(500, text="not json")
    assert safe_response_json(res) == {}


def test_safe_response_json_valid_object() -> None:
    res = httpx.Response(200, json={"state": {"player": {"x": 1, "y": 2}}})
    assert safe_response_json(res) == {"state": {"player": {"x": 1, "y": 2}}}


def test_safe_response_json_non_object_returns_default() -> None:
    res = httpx.Response(200, json=[1, 2, 3])
    assert safe_response_json(res) == {}


def test_safe_response_json_custom_default() -> None:
    res = httpx.Response(200, text="")
    assert safe_response_json(res, default={"ok": False}) == {"ok": False}
