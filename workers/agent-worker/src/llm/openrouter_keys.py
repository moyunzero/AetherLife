import os

from src.config import Settings


def openrouter_keys(settings: Settings) -> list[str]:
    """Primary + secondary OpenRouter keys (deduped, order preserved)."""
    seen: set[str] = set()
    out: list[str] = []
    csv = os.getenv("OPENROUTER_API_KEYS", "").strip()
    if csv:
        for part in csv.split(","):
            key = part.strip()
            if key and key not in seen:
                seen.add(key)
                out.append(key)
    for raw in (settings.openrouter_api_key, settings.openrouter_api_key_2):
        if raw and raw not in seen:
            seen.add(raw)
            out.append(raw)
    return out
