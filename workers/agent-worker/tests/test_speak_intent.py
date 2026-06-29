"""Tests for speak intent classification."""

from src.graph.speak_intent import (
    SpeakIntent,
    can_use_casual_fast_lane,
    can_use_social_edge_fast_lane,
    classify_speak_intent,
    should_skip_memory_context,
    should_skip_memory_embed,
)


def test_physical_intent():
    assert classify_speak_intent("向右走一步") == SpeakIntent.PHYSICAL
    assert classify_speak_intent("打开门") == SpeakIntent.PHYSICAL
    assert classify_speak_intent("去阿斯托利亚旁边") == SpeakIntent.PHYSICAL
    assert classify_speak_intent("move to (3,4)") == SpeakIntent.PHYSICAL
    assert classify_speak_intent("请帮我走到左侧") == SpeakIntent.PHYSICAL


def test_recall_intent():
    assert classify_speak_intent("你还记得密码吗") == SpeakIntent.RECALL
    assert classify_speak_intent("上次说的数字是多少") == SpeakIntent.RECALL
    assert classify_speak_intent("之前告诉你的门牌号是什么") == SpeakIntent.RECALL
    assert classify_speak_intent("还记得我们说过什么吗") == SpeakIntent.RECALL
    assert classify_speak_intent("你提过那个约定吗") == SpeakIntent.RECALL


def test_recall_wins_over_casual_greeting():
    assert classify_speak_intent("你好，还记得密码吗") == SpeakIntent.RECALL


def test_social_edge_intent():
    assert classify_speak_intent("你这个废物") == SpeakIntent.SOCIAL_EDGE
    assert classify_speak_intent("请帮帮我") == SpeakIntent.SOCIAL_EDGE
    assert classify_speak_intent("滚开") == SpeakIntent.SOCIAL_EDGE
    assert classify_speak_intent("你真蠢") == SpeakIntent.SOCIAL_EDGE
    assert classify_speak_intent("能请你帮个忙吗") == SpeakIntent.SOCIAL_EDGE


def test_casual_intent():
    assert classify_speak_intent("你好") == SpeakIntent.CASUAL
    assert classify_speak_intent("Hi") == SpeakIntent.CASUAL
    assert classify_speak_intent("早上好") == SpeakIntent.CASUAL
    assert classify_speak_intent("用一句话简短回复") == SpeakIntent.CASUAL
    assert classify_speak_intent("你好，用一句话简短回复") == SpeakIntent.CASUAL


def test_narrative_default():
    assert classify_speak_intent("故宫在哪里，给我讲讲历史") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("那里有什么历史？") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("这个世界是怎么形成的") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("你在做什么呢？") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("你在做什么呢～") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("你喜欢做什么呢？") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("今天不错") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("你好狂啊～") == SpeakIntent.NARRATIVE
    assert classify_speak_intent("在啥啊") == SpeakIntent.NARRATIVE


def test_casual_skips_memory_context():
    assert should_skip_memory_context(SpeakIntent.CASUAL) is True
    assert should_skip_memory_context(SpeakIntent.PHYSICAL) is True
    assert should_skip_memory_context(SpeakIntent.RECALL) is False
    assert should_skip_memory_context(SpeakIntent.NARRATIVE) is False


def test_can_use_casual_fast_lane_b1():
    intent, turn = can_use_casual_fast_lane("你好，用一句话简短回复")
    assert intent == SpeakIntent.CASUAL
    assert turn is not None
    assert turn.reply


def test_can_use_casual_fast_lane_recall_blocked():
    intent, turn = can_use_casual_fast_lane("你好，还记得密码吗")
    assert intent == SpeakIntent.RECALL
    assert turn is None


def test_can_use_casual_fast_lane_physical_blocked():
    intent, turn = can_use_casual_fast_lane("向右走一步")
    assert intent == SpeakIntent.PHYSICAL
    assert turn is None


def test_can_use_casual_fast_lane_narrative_blocked():
    intent, turn = can_use_casual_fast_lane("故宫在哪里，给我讲讲历史")
    assert intent == SpeakIntent.NARRATIVE
    assert turn is None


def test_skip_embed_matrix():
    assert should_skip_memory_embed(SpeakIntent.CASUAL) is True
    assert should_skip_memory_embed(SpeakIntent.SOCIAL_EDGE) is True
    assert should_skip_memory_embed(SpeakIntent.NARRATIVE) is True
    assert should_skip_memory_embed(SpeakIntent.RECALL) is False
    assert should_skip_memory_embed(SpeakIntent.PHYSICAL) is False


def test_can_use_social_edge_fast_lane_rude():
    intent, turn = can_use_social_edge_fast_lane("你真粗鲁")
    assert intent == SpeakIntent.SOCIAL_EDGE
    assert turn is not None
    assert turn.social.kind == "rude"


def test_can_use_social_edge_fast_lane_help():
    intent, turn = can_use_social_edge_fast_lane("请帮帮忙")
    assert intent == SpeakIntent.SOCIAL_EDGE
    assert turn is not None
    assert turn.social.kind == "help"


def test_can_use_social_edge_fast_lane_narrative_blocked():
    intent, turn = can_use_social_edge_fast_lane("故宫在哪里，给我讲讲历史")
    assert intent == SpeakIntent.NARRATIVE
    assert turn is None
