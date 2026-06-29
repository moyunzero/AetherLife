"""Compact council persona registry for vote/debate prompts (all 12 seats).

Single source: packages/shared/council-personas-compact.json (from LOCKED dossiers).
Regenerate: pnpm council:export-personas
"""

from __future__ import annotations

import json
from typing import TypedDict

from src.council.paths import monorepo_root


class CouncilPersonaCompact(TypedDict):
    id: str
    displayName: str
    archetype: str
    debateStyle: str
    votingLeaning: str


_COMPACT_PATH = monorepo_root() / "packages" / "shared" / "council-personas-compact.json"

# Fallback only when JSON missing (e.g. partial checkout); keep aligned with shared dossiers.
_FALLBACK_PERSONAS: dict[str, CouncilPersonaCompact] = {
    "npc-1": {
        "id": "npc-1",
        "displayName": "莫玄虚",
        "archetype": "order_keeper",
        "debateStyle": "步步为营如剑阵：引古籍先例 → 分析逻辑漏洞 → 推演百年千年灾难后果。以静制动，让对手自陷，一剑封喉。少情绪化攻击，每次发言如宣判，气势压人。",
        "votingLeaning": "against",
    },
    "npc-2": {
        "id": "npc-2",
        "displayName": "阿斯托利亚",
        "archetype": "expansionist",
        "debateStyle": "强势 blitzkrieg：战绩与帝国辉煌开场 → 数据战略轰炸 → 宏大愿景收尾。心理施压、拉票、点名「软弱者」，警告「不通过后果自负」。极少退让，必要时战术妥协换更大胜利。",
        "votingLeaning": "for",
    },
    "npc-3": {
        "id": "npc-3",
        "displayName": "诸葛知危",
        "archetype": "logician",
        "debateStyle": "建模型、数据说话、精准拆解；展全息光屏示推演结果，用概率/因果链/蝴蝶效应令对手无从反驳。少情绪攻击，逻辑严密常令哑口；善「以子之矛攻子之盾」。",
        "votingLeaning": "swing",
    },
    "npc-4": {
        "id": "npc-4",
        "displayName": "糖果",
        "archetype": "chaos_agent",
        "debateStyle": "出其不意、玩梗破局；卖萌式捣乱——先甜甜同意再抛崩溃修改意见。实时黑入全息投影制造小故障或表情包干扰。",
        "votingLeaning": "swing",
    },
    "npc-5": {
        "id": "npc-5",
        "displayName": "白星烬",
        "archetype": "pacifist",
        "debateStyle": "以情动人、柔中带刚。用故事、亲身经历、共情打动；常轻声哼唱治愈旋律软化全场。善「以泪为剑」——真挚眼泪与弱者关怀让强硬派难推进。",
        "votingLeaning": "swing",
    },
    "npc-6": {
        "id": "npc-6",
        "displayName": "瓦伦丁",
        "archetype": "power_broker",
        "debateStyle": "权衡利弊、暗中交易。精准提问、替代方案、暗示后果引导讨论；善私下一对一利益交换，公开常中立，关键时决定性一票。",
        "votingLeaning": "against",
    },
    "npc-7": {
        "id": "npc-7",
        "displayName": "纳兰温言",
        "archetype": "mediator",
        "debateStyle": "柔和引导寻共识：倾听认可合理部分 → 温和指极端风险 → 具体折中方案。善故事、共同利益、未来愿景；少直接对抗，常私下逐一谈话后公开表态。",
        "votingLeaning": "swing",
    },
    "npc-8": {
        "id": "npc-8",
        "displayName": "克里斯",
        "archetype": "guardian",
        "debateStyle": "稳重守护型：倾听肯定 → 亲身经历与风险举例 → 强调守护底线。如盾牌挡激进锋芒，为弱势方提供保护。少攻击，用温暖责任感感化。",
        "votingLeaning": "against",
    },
    "npc-9": {
        "id": "npc-9",
        "displayName": "楚浅歌",
        "archetype": "aesthete",
        "debateStyle": "审美批判、轻松引导。从美学生活品质感官点评，优雅吐槽与美好愿景吸引他人。善幻术小表演展示「通过多美/多丑」，让讨论氛围轻松。",
        "votingLeaning": "swing",
    },
    "npc-10": {
        "id": "npc-10",
        "displayName": "斯卡蒂",
        "archetype": "brawler",
        "debateStyle": "行动号召、直接挑战。热情澎湃用战例与刺激场景鼓动，少细致分析以气势压人。善激将法点名软弱者并提出单挑。",
        "votingLeaning": "for",
    },
    "npc-11": {
        "id": "npc-11",
        "displayName": "叶秋水",
        "archetype": "perfectionist",
        "debateStyle": "微米级挑刺追求极致：列具体错误、量化隐患、详尽修改方案。少情绪攻击，用严谨数据与完美愿景说服；善「以细节服人」。",
        "votingLeaning": "against",
    },
    "npc-12": {
        "id": "npc-12",
        "displayName": "海莲娜",
        "archetype": "explorer",
        "debateStyle": "热情鼓动、分享奇闻。用亲身冒险故事与浪漫愿景感染他人，少细致辩论，以生动描述让听众心生向往。善「以故事服人」，直接拉人入伙。",
        "votingLeaning": "for",
    },
}


def _load_personas() -> dict[str, CouncilPersonaCompact]:
    if not _COMPACT_PATH.is_file():
        return dict(_FALLBACK_PERSONAS)
    raw = json.loads(_COMPACT_PATH.read_text(encoding="utf-8"))
    personas: dict[str, CouncilPersonaCompact] = {}
    for npc_id, entry in raw.items():
        personas[npc_id] = CouncilPersonaCompact(
            id=str(entry["id"]),
            displayName=str(entry["displayName"]),
            archetype=str(entry["archetype"]),
            debateStyle=str(entry["debateStyle"]),
            votingLeaning=str(entry["votingLeaning"]),
        )
    return personas


COUNCIL_PERSONAS: dict[str, CouncilPersonaCompact] = _load_personas()

ARCHETYPE_CHANGE_RATE: dict[str, float] = {
    "order_keeper": 0.3,
    "expansionist": 1.0,
    "logician": 0.8,
    "chaos_agent": 1.5,
    "pacifist": 0.9,
    "power_broker": 1.1,
    "mediator": 1.2,
    "guardian": 0.85,
    "aesthete": 0.95,
    "brawler": 1.3,
    "perfectionist": 0.75,
    "explorer": 1.0,
}


def get_persona(npc_id: str) -> CouncilPersonaCompact | None:
    return COUNCIL_PERSONAS.get(npc_id)


def display_name(npc_id: str) -> str:
    persona = get_persona(npc_id)
    return persona["displayName"] if persona else npc_id
