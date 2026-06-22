"""Deterministic recall merge for PLAY-03 — factual answers without meta callback phrasing."""

from __future__ import annotations

import re
from typing import Any

_RECALL_MARKERS = (
    "记得",
    "还记得",
    "多少",
    "是什么",
    "是啥",
    "叫什么",
    "之前",
    "上次",
    "刚才",
    "告诉",
    "说过",
    "提过",
)
# Strong cues — interrogative recall without extra question punctuation.
_STRONG_RECALL_MARKERS = ("多少", "叫什么", "是什么", "是啥", "还记得")
# Player is seeding a fact, not asking NPC to recall.
_DISCLOSURE_MARKERS = (
    "我告诉你",
    "告诉你一个",
    "告诉你个",
    "请记住",
    "记住这个",
    "有个秘密",
)
_REFUSAL_MARKERS = ("自重", "不信任", "不便透露", "无可奉告", "不能告诉", "不会告诉")
_ROLE_PREFIX = re.compile(r"^(?:player|npc)\s*:\s*", re.IGNORECASE)
_PLAYER_ROLE_PREFIX = re.compile(r"^player\s*:\s*", re.IGNORECASE)
_NPC_PARAPHRASE_MARKERS = ("你刚刚说", "你之前说", "你之前提到", "提到过", "都说过")
_PASSWORD_ANS_RE = re.compile(
    r"密码(?:是|为|[:：])\s*([^\s。，,.!?；;～~吗呢吧啊？?]+)",
    re.IGNORECASE,
)
_INVALID_PASSWORD_ANSWERS = frozenset({"吗", "呢", "吧", "啊", "么"})
_INVALID_FOOD_ANSWERS = frozenset({"什么", "啥", "吗", "呢", "吧", "啊", "么"})
_NICKNAME_MEM_RE = re.compile(
    r"(?:请记住)?(?:我)?叫([^。，,.!?；;\s]+)|叫我([^。，,.!?；;\s]+)",
    re.IGNORECASE,
)
_FOOD_PREF_MEM_RE = re.compile(
    r"(?:最喜欢|最爱|喜欢|爱)吃([^。，,.!?；;\s～~吗呢吧啊？?]+)",
    re.IGNORECASE,
)
_FOOD_RECALL_RE = re.compile(r"喜欢吃什么|爱吃什么|最爱吃|口味|爱吃什么", re.IGNORECASE)
_META_CALLBACK_RE = re.compile(r"你(?:上次|之前|刚才)(?:说|告诉|提过)")

DEFAULT_RECALL_MIN_SCORE = 0.35


def _has_question_cue(message: str) -> bool:
    msg = message.strip()
    if not msg:
        return False
    if "?" in msg or "？" in msg:
        return True
    if msg.endswith("吗") or msg.endswith("吗？") or msg.endswith("吗?"):
        return True
    return any(marker in msg for marker in _STRONG_RECALL_MARKERS)


def is_recall_question(message: str) -> bool:
    msg = message.strip()
    if not msg:
        return False
    if any(marker in msg for marker in _DISCLOSURE_MARKERS):
        return False
    if any(marker in msg for marker in _STRONG_RECALL_MARKERS):
        return True
    if not any(marker in msg for marker in _RECALL_MARKERS):
        return False
    return _has_question_cue(msg)


def best_retrieved_memory(
    retrieved_memories: list[dict[str, Any]] | None,
    *,
    min_score: float = DEFAULT_RECALL_MIN_SCORE,
) -> dict[str, Any] | None:
    items = retrieved_memories or []
    if not items:
        return None
    best = max(items, key=lambda item: float(item.get("score") or 0))
    if float(best.get("score") or 0) < min_score:
        return None
    return best


def _memory_raw_text(item: dict[str, Any]) -> str:
    return str(item.get("text") or item.get("content") or "").strip()


def _memory_item_text(item: dict[str, Any]) -> str:
    return _strip_role_prefix(_memory_raw_text(item))


def _is_player_password_seed(raw_text: str) -> bool:
    if not _PLAYER_ROLE_PREFIX.match(raw_text.strip()):
        return False
    body = _strip_role_prefix(raw_text)
    if any(marker in body for marker in _DISCLOSURE_MARKERS):
        return True
    return bool(_PASSWORD_ANS_RE.search(body))


def _player_password_seed_score(raw_text: str) -> int:
    if not _is_player_password_seed(raw_text):
        return 0
    body = _strip_role_prefix(raw_text)
    if any(marker in body for marker in _DISCLOSURE_MARKERS):
        return 3
    return 2


def _is_npc_password_paraphrase(raw_text: str) -> bool:
    if not raw_text.strip().lower().startswith("npc:"):
        return False
    body = _strip_role_prefix(raw_text)
    if "密码" not in body:
        return False
    return any(marker in body for marker in _NPC_PARAPHRASE_MARKERS)


def _strip_meta_callback(reply: str) -> str:
    return _META_CALLBACK_RE.sub("", reply).strip()


def pick_recall_memory(
    player_message: str,
    retrieved_memories: list[dict[str, Any]] | None,
    *,
    min_score: float = DEFAULT_RECALL_MIN_SCORE,
) -> dict[str, Any] | None:
    """Pick the retrieved row that matches the recall question type, not only top score."""
    items = retrieved_memories or []
    msg = player_message.strip()
    if _is_food_recall_question(msg):
        return _pick_food_memory(items, min_score=min_score)
    scored = [item for item in items if float(item.get("score") or 0) >= min_score]
    if not scored:
        return None
    ranked = sorted(scored, key=lambda item: float(item.get("score") or 0), reverse=True)
    if "密码" in msg:
        return _pick_password_memory(msg, ranked)
    if _is_nickname_recall_question(msg):
        for item in ranked:
            if extract_nickname(_memory_item_text(item)):
                return item
        return None
    return best_retrieved_memory(retrieved_memories, min_score=min_score)


def _strip_role_prefix(text: str) -> str:
    return _ROLE_PREFIX.sub("", text.strip()).strip()


def extract_password_answer(memory_text: str) -> str | None:
    text = _strip_role_prefix(memory_text.strip())
    if text and is_recall_question(text):
        return None
    match = _PASSWORD_ANS_RE.search(memory_text)
    if not match:
        return None
    answer = match.group(1).strip().rstrip("。，,.!?；;～~")
    if not answer or answer in _INVALID_PASSWORD_ANSWERS:
        return None
    return answer


def extract_nickname(memory_text: str) -> str | None:
    text = _strip_role_prefix(memory_text.strip())
    if text and is_recall_question(text):
        return None
    match = _NICKNAME_MEM_RE.search(memory_text)
    if not match:
        return None
    nickname = (match.group(1) or match.group(2) or "").strip().rstrip("。，,.!?；;")
    return nickname or None


def _is_nickname_recall_question(message: str) -> bool:
    return "叫什么" in message or "名字" in message


def _is_food_recall_question(message: str) -> bool:
    return bool(_FOOD_RECALL_RE.search(message.strip()))


def extract_food_preference(memory_text: str) -> str | None:
    text = _strip_role_prefix(memory_text.strip())
    if text and is_recall_question(text):
        return None
    match = _FOOD_PREF_MEM_RE.search(text)
    if not match:
        return None
    food = match.group(1).strip().rstrip("～~")
    if not food or food in _INVALID_FOOD_ANSWERS:
        return None
    return food


def needs_recency_augment(player_message: str) -> bool:
    """Password/nickname recall must prefer newest stored fact over embed rank."""
    msg = player_message.strip()
    if not is_recall_question(msg):
        return False
    return "密码" in msg or _is_nickname_recall_question(msg) or _is_food_recall_question(msg)


def _password_topic(player_message: str) -> str | None:
    msg = player_message.strip()
    if "电脑" in msg and "密码" in msg:
        return "computer"
    if "门禁" in msg or "门锁" in msg:
        return "door"
    if "密码" in msg:
        return "generic"
    return None


def _password_topic_score(player_message: str, memory_text: str) -> int:
    topic = _password_topic(player_message)
    if topic == "computer":
        if "电脑" in memory_text or "电脑密码" in memory_text:
            return 2
        if "门锁" in memory_text or "门禁" in memory_text:
            return -1
        return 1
    if topic == "door":
        if "门锁" in memory_text or "门禁" in memory_text:
            return 2
        if "电脑" in memory_text or "电脑密码" in memory_text:
            return -1
        return 1
    if topic == "generic":
        return 1
    return 0


_AMBIGUOUS_RECALL_RE = re.compile(r"不确定|两个|都说过|或者|还是|记不清|哪个")


def _reply_is_ambiguous_password_recall(hay: str, canonical_pwd: str) -> bool:
    if _AMBIGUOUS_RECALL_RE.search(hay):
        return True
    numbers = re.findall(r"\d+", hay)
    distinct = {n for n in numbers if n}
    if len(distinct) > 1:
        return True
    if len(distinct) == 1 and canonical_pwd not in distinct:
        return True
    return False


def augment_retrieved_with_recent(
    retrieved: list[dict[str, Any]] | None,
    recent_rows: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Merge DB recency (newest first) ahead of embed-ranked rows."""
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for idx, row in enumerate(recent_rows or []):
        text = str(row.get("text") or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        merged.append(
            {
                "text": text,
                "score": max(0.96 - idx * 0.015, 0.35),
                "recencyRank": idx,
            }
        )
    for item in retrieved or []:
        text = str(item.get("text") or item.get("content") or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        merged.append({**item, "recencyRank": item.get("recencyRank", 999)})
    return merged


def augment_retrieved_with_dialogue_turns(
    retrieved: list[dict[str, Any]] | None,
    recent_turns: list[dict[str, str]] | None,
) -> list[dict[str, Any]]:
    """Merge in-session player turns ahead of DB/embed rows (memory tail may lag)."""
    if not recent_turns:
        return list(retrieved or [])

    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    player_texts: list[str] = []
    for turn in reversed(recent_turns):
        role = (turn.get("role") or "").lower()
        if role != "player":
            continue
        raw = str(turn.get("text") or "").strip()
        if not raw:
            continue
        text = raw if raw.lower().startswith("player:") else f"player: {raw}"
        if text in seen:
            continue
        seen.add(text)
        player_texts.append(text)

    for idx, text in enumerate(player_texts):
        merged.append(
            {
                "text": text,
                "score": max(0.995 - idx * 0.01, 0.5),
                "recencyRank": idx,
                "dialogueSession": True,
            }
        )

    for item in retrieved or []:
        text = str(item.get("text") or item.get("content") or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        merged.append(
            {**item, "recencyRank": item.get("recencyRank", len(merged) + 999)}
        )
    return merged


def _is_player_food_seed(raw_text: str) -> bool:
    if not _PLAYER_ROLE_PREFIX.match(raw_text.strip()):
        return False
    return extract_food_preference(_strip_role_prefix(raw_text)) is not None


def _pick_food_memory(
    items: list[dict[str, Any]],
    *,
    min_score: float = DEFAULT_RECALL_MIN_SCORE,
) -> dict[str, Any] | None:
    """Prefer player-seeded food facts; scan all rows (embed may rank recall questions higher)."""
    candidates: list[dict[str, Any]] = []
    for item in items:
        if extract_food_preference(_memory_item_text(item)):
            candidates.append(item)
    if not candidates:
        return None

    def sort_key(item: dict[str, Any]) -> tuple[int, int, float]:
        raw = _memory_raw_text(item)
        seed = 1 if _is_player_food_seed(raw) else 0
        recency = int(item.get("recencyRank", 999))
        embed = float(item.get("score") or 0)
        meets_min = 1 if embed >= min_score else 0
        return (-seed, -meets_min, recency, -embed)

    player_seeds = [
        item
        for item in candidates
        if _is_player_food_seed(_memory_raw_text(item))
    ]
    pool = player_seeds if player_seeds else candidates
    return min(pool, key=sort_key)


def _pick_password_memory(
    player_message: str,
    ranked: list[dict[str, Any]],
) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for item in ranked:
        text = _memory_item_text(item)
        if extract_password_answer(text):
            candidates.append(item)
    if not candidates:
        return None

    topic = _password_topic(player_message)
    topic_matches = [
        item
        for item in candidates
        if _password_topic_score(player_message, _memory_item_text(item)) > 0
    ]
    if topic in ("computer", "door") and not topic_matches:
        return None
    if topic_matches:
        candidates = topic_matches

    def sort_key(item: dict[str, Any]) -> tuple[int, int, int, float]:
        raw = _memory_raw_text(item)
        text = _memory_item_text(item)
        seed = _player_password_seed_score(raw)
        topic = _password_topic_score(player_message, text)
        recency = int(item.get("recencyRank", 999))
        embed = float(item.get("score") or 0)
        return (-seed, -topic, recency, -embed)

    player_seeds = [
        item
        for item in candidates
        if _is_player_password_seed(_memory_raw_text(item))
        and not _is_npc_password_paraphrase(_memory_raw_text(item))
    ]
    pool = player_seeds if player_seeds else candidates
    return min(pool, key=sort_key)


def _seed_tokens(message: str, memory_text: str) -> list[str]:
    tokens: list[str] = []
    for source in (message, memory_text):
        for match in re.finditer(r"[A-Z][A-Z0-9_-]{4,}", source):
            token = match.group(0)
            if token not in tokens:
                tokens.append(token)
    return tokens


def reply_covers_recall(
    reply: str,
    *,
    player_message: str,
    memory_text: str,
) -> bool:
    hay = reply.strip()
    if not hay:
        return False
    pwd = extract_password_answer(memory_text)
    if pwd and "密码" in player_message:
        if pwd not in hay:
            return False
        return not _reply_is_ambiguous_password_recall(hay, pwd)
    nickname = extract_nickname(memory_text)
    if nickname and _is_nickname_recall_question(player_message):
        return nickname in hay
    food = extract_food_preference(memory_text)
    if food and _is_food_recall_question(player_message):
        return food in hay
    for token in _seed_tokens(player_message, memory_text):
        if token in hay:
            return True
    if pwd and pwd in hay:
        return True
    return False


def reply_refuses_recall(reply: str) -> bool:
    return any(marker in reply for marker in _REFUSAL_MARKERS)


def recall_no_memory_reply(player_message: str) -> str:
    """Honest answer when recall was asked but no matching fact exists in memory."""
    msg = player_message.strip()
    if "密码" in msg:
        if "电脑" in msg:
            return "你没告诉过我电脑密码。"
        return "你没告诉过我这道密码。"
    if _is_nickname_recall_question(msg):
        return "你没告诉过我你的名字。"
    if _is_food_recall_question(msg):
        return "你没告诉过我你喜欢吃什么。"
    return "这个你没跟我说过，我这边没有印象。"


def format_recall_answer(player_message: str, memory_text: str) -> str | None:
    """Short in-character fact — no 「你上次说过」 meta phrasing."""
    pwd = extract_password_answer(memory_text)
    if pwd and "密码" in player_message:
        if "电脑" in player_message:
            return f"电脑密码是 {pwd}。"
        return f"门禁密码是 {pwd}。"
    nickname = extract_nickname(memory_text)
    if nickname and _is_nickname_recall_question(player_message):
        return f"你叫{nickname}。"
    food = extract_food_preference(memory_text)
    if food and _is_food_recall_question(player_message):
        return f"你喜欢吃{food}。"
    if pwd:
        return f"{pwd}。"
    for token in _seed_tokens(player_message, memory_text):
        if token in memory_text:
            return f"{token}。"
    return None


def merge_recall_into_reply(
    player_message: str,
    reply: str,
    retrieved_memories: list[dict[str, Any]] | None,
    *,
    min_score: float = DEFAULT_RECALL_MIN_SCORE,
) -> str:
    if not is_recall_question(player_message):
        return reply
    best = pick_recall_memory(
        player_message,
        retrieved_memories,
        min_score=min_score,
    )
    if best is None:
        return recall_no_memory_reply(player_message)
    memory_text = _memory_item_text(best)
    if not memory_text:
        return recall_no_memory_reply(player_message)
    draft = (reply or "").strip()
    if reply_covers_recall(draft, player_message=player_message, memory_text=memory_text):
        return _strip_meta_callback(draft) or draft
    if reply_refuses_recall(draft):
        draft = ""
    fact = format_recall_answer(player_message, memory_text)
    if not fact:
        return recall_no_memory_reply(player_message)
    pwd = extract_password_answer(memory_text)
    if pwd and "密码" in player_message:
        if not draft or pwd not in draft or _reply_is_ambiguous_password_recall(draft, pwd):
            return fact
    if not draft:
        return fact
    nickname = extract_nickname(memory_text)
    if nickname and _is_nickname_recall_question(player_message) and nickname not in draft:
        return fact
    food = extract_food_preference(memory_text)
    if food and _is_food_recall_question(player_message) and food not in draft:
        return fact
    return f"{draft} {fact}".strip()
