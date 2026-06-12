from types import SimpleNamespace

from src.graph.tools import parse_tool_calls


def test_parse_tool_calls_empty_string_args() -> None:
    message = SimpleNamespace(
        tool_calls=[SimpleNamespace(name="speak", args="")]
    )
    assert parse_tool_calls(message) == [{"name": "speak", "args": {}}]


def test_parse_tool_calls_whitespace_args() -> None:
    message = SimpleNamespace(
        tool_calls=[SimpleNamespace(name="move", args="   ")]
    )
    assert parse_tool_calls(message) == [{"name": "move", "args": {}}]


def test_parse_tool_calls_json_string_args() -> None:
    message = SimpleNamespace(
        tool_calls=[SimpleNamespace(name="speak", args='{"content": "hi"}')]
    )
    assert parse_tool_calls(message) == [{"name": "speak", "args": {"content": "hi"}}]


def test_parse_tool_calls_invalid_json_string_args() -> None:
    message = SimpleNamespace(
        tool_calls=[SimpleNamespace(name="move", args="{not json")]
    )
    assert parse_tool_calls(message) == [{"name": "move", "args": {}}]
