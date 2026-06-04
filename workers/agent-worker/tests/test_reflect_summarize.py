from src.config import Settings
from src.graph.reflect import should_reflect
from src.graph.summarize import maybe_bulk_summarize, run_bulk_summarize_llm


def test_should_reflect_every_n():
    assert should_reflect(5, 5)
    assert should_reflect(10, 5)
    assert not should_reflect(4, 5)
    assert not should_reflect(0, 5)


def test_bulk_summarize_mock_llm():
    text = run_bulk_summarize_llm(["a", "b", "c"], Settings(llm_mock=True))
    assert "3 memories" in text


def test_maybe_bulk_summarize_skips_below_threshold(monkeypatch):
    settings = Settings(llm_mock=True, summarize_threshold=100)
    client = __import__("unittest.mock").mock.MagicMock()
    assert maybe_bulk_summarize(client, settings, "default", 50) is False
    client.get.assert_not_called()
