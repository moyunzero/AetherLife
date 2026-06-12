import json
from types import SimpleNamespace

import pytest

from src.llm.invoke_tools import invoke_tool_bound_llm


def test_invoke_tool_bound_llm_falls_back_on_empty_tool_args_json() -> None:
    base = SimpleNamespace(
        invoke=lambda messages: SimpleNamespace(content="fallback reply", tool_calls=[]),
    )
    bound = SimpleNamespace(
        bound=base,
        invoke=lambda messages: (_ for _ in ()).throw(json.JSONDecodeError("Expecting value", "", 0)),
    )

    response = invoke_tool_bound_llm(bound, [{"role": "user", "content": "hi"}])

    assert response.content == "fallback reply"


def test_invoke_tool_bound_llm_reraises_unrelated_errors() -> None:
    bound = SimpleNamespace(
        invoke=lambda messages: (_ for _ in ()).throw(RuntimeError("network down")),
    )

    with pytest.raises(RuntimeError, match="network down"):
        invoke_tool_bound_llm(bound, [])
