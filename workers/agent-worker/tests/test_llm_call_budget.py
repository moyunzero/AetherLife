from src.llm.call_budget import (
    LlmCallRecorder,
    llm_call_summary_payload,
    record_llm_call,
    start_recorder,
)


def test_recorder_accumulates_roles():
    rec = LlmCallRecorder()
    rec.record("social", "siliconflow", "Qwen/Qwen3.5-4B")
    rec.record("main", "siliconflow", "Qwen/Qwen3.5-4B")
    assert rec.total == 2
    assert rec.summarize()[0]["role"] == "social"
    assert rec.summarize()[1]["role"] == "main"


def test_contextvar_record_llm_call():
    rec = start_recorder()
    record_llm_call("importance", "nvidia", "nvidia/llama-3.1-nemotron-nano-8b-v1")
    assert rec.total == 1
    payload = llm_call_summary_payload(rec)
    assert payload is not None
    assert payload["total"] == 1
    assert payload["calls"][0]["role"] == "importance"
