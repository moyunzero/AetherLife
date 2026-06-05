import re

_CHANNEL_WORD = re.compile(r"<\|channel\|>\w*", re.IGNORECASE)
_CHANNEL_TAG_WORD = re.compile(r"<\|[^|>]+\|>\w*", re.IGNORECASE)
_CHANNEL_TAG = re.compile(r"<\|[^|>]+\|>", re.IGNORECASE)
_BARE_CHANNEL = re.compile(r"\|channel\|>\w*", re.IGNORECASE)


def sanitize_npc_reply(text: str) -> str:
    cleaned = _CHANNEL_WORD.sub("", text)
    cleaned = _CHANNEL_TAG_WORD.sub("", cleaned)
    cleaned = _CHANNEL_TAG.sub("", cleaned)
    cleaned = _BARE_CHANNEL.sub("", cleaned)
    return cleaned.strip()
