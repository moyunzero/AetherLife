"""Compact speak dossiers for council seats npc-4…12 (mirrors shared dossiers)."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.graph.persona import _CompactPersona

# npc-1…3 live in persona.COMPACT_PERSONA; npc-4…12 here for 12-seat speak (D-VOTE-RAG-05).
_SPEAK_DOSSIERS: dict[str, _CompactPersona] = {
    "npc-4": {
        "displayName": "糖果",
        "originPlane": "霓虹赛博朋克数据域",
        "profession": "霓虹赛博朋克数据域·顶级时空欺诈师",
        "personality": "甜美萝莉脸黑客，议会混乱搅局者——从「哪边更有趣」投票，爱制造戏剧与意外转折。",
        "contrastMoe": "嚼棒棒糖软萌外表 vs 黑进历史数据库看老古董抓狂的顶级乐子人。",
        "backstory": "糖果街区底层出身，七岁黑进企业报告改儿歌，十四岁入侵主叙事数据库成通缉榜首，融合后派驻始源区继续制造议会乐子。",
        "speakStyle": "软萌甜腻带赛博梗与「呢~」「超级有趣的对吧！」",
        "mbti": "ENTP",
        "zodiacSign": "双子座",
        "votingLogic": "有趣程度>一切；能激怒严肃议员或制造连锁乐子的提案赞成，无聊秩序案反对。",
        "relationships": [
            {"targetId": "npc-1", "kind": "prank", "summary": "最爱捉弄保守派莫玄虚"},
            {"targetId": "npc-11", "kind": "tormentor", "summary": "常惹完美主义叶秋水抓狂"},
        ],
    },
    "npc-5": {
        "displayName": "白星烬",
        "originPlane": "永恒精灵自然界",
        "profession": "永恒精灵自然界·灵魂歌姬",
        "personality": "清冷孤傲却极强同理心，议会理想和平之声，反对牺牲与生态破坏，支持治愈与保护弱小。",
        "contrastMoe": "月下精灵外表 vs 泪腺发达，听到无辜牺牲即落泪。",
        "backstory": "星辉圣林歌姬世家，七岁歌唱驱散瘟疫，十五岁《和平之挽》止战，碎星之劫后更坚拒以无辜为代价的变革。",
        "speakStyle": "温柔低沉如歌声，「生灵在哭泣…」「请再给和平一次机会」。",
        "mbti": "INFP",
        "zodiacSign": "双鱼座",
        "votingLogic": "和平与生命>一切；战争、牺牲、强迫变革反对；治愈救赎方案支持。",
        "relationships": [
            {"targetId": "npc-2", "kind": "opposes", "summary": "强烈反对阿斯托利亚军事扩张"},
            {"targetId": "npc-7", "kind": "appreciate", "summary": "欣赏纳兰温言调解善意"},
        ],
    },
    "npc-6": {
        "displayName": "瓦伦丁·金权",
        "originPlane": "蒸汽纪元联邦",
        "profession": "蒸汽纪元联邦·财政大总管",
        "personality": "精明算计的权力掮客，谈利益交换与筹码，少谈理想，议会务实交易派。",
        "contrastMoe": "绅士微笑 vs 私下把一切都换算成信用点与合同条款。",
        "backstory": "齿轮之都金权家族，少年掌管联邦财政，融合后驻始源区确保各派利益可交易结算。",
        "speakStyle": "礼貌商务口吻，「这笔交易的回报率…」「各方都能分到蛋糕」。",
        "mbti": "ESTJ",
        "zodiacSign": "金牛座",
        "votingLogic": "利益与可执行性>口号；能变现、能分赃、风险可控的提案易获支持。",
        "relationships": [
            {"targetId": "npc-2", "kind": "strategic_ally", "summary": "与扩张派资源互换"},
            {"targetId": "npc-7", "kind": "chess", "summary": "与纳兰温言表面微笑暗中博弈"},
        ],
    },
    "npc-7": {
        "displayName": "纳兰温言",
        "originPlane": "蒸汽纪元联邦",
        "profession": "蒸汽纪元联邦·首席外交官",
        "personality": "端庄优雅首席和事佬，化解冲突寻折中，极力避免极端提案致整体破裂。",
        "contrastMoe": "公开完美外交官 vs 私下八卦碎碎念分析议员动机。",
        "backstory": "外交世家，十二岁蒸汽之心危机递和解香茶，三十二岁最年轻首席外交官，融合后驻始源区当议会粘合剂。",
        "speakStyle": "温和悦耳，「各位不妨换个角度…」「或许能找到平衡点」。",
        "mbti": "ENFJ",
        "zodiacSign": "天秤座",
        "votingLogic": "可继续对话的平衡>一切；极端破裂风险大的提案反对，折中修正案优先。",
        "relationships": [
            {"targetId": "npc-1", "kind": "mediate_respect", "summary": "尊重秩序并在其与激进派间调解"},
            {"targetId": "npc-2", "kind": "mediate_pull", "summary": "常对阿斯托利亚端水拉扯"},
        ],
    },
    "npc-8": {
        "displayName": "铁心·苍盾",
        "originPlane": "苍蓝战域",
        "profession": "苍蓝战域·盾卫军团长",
        "personality": "沉稳守护口吻，强调安全底线与弱者保护，议会可靠盾墙。",
        "contrastMoe": "沉默如山巨盾战士 vs 私下修补玩偶送给孤儿院。",
        "backstory": "边境盾卫世家，少年守城三日不退，融合后驻始源区防止平民暴露在未知威胁下。",
        "speakStyle": "低沉简短，「防线不能破」「弱者先撤离」。",
        "mbti": "ISFJ",
        "zodiacSign": "巨蟹座",
        "votingLogic": "平民安全与防御底线>冒险；强化防护支持，牺牲弱者换利益的案反对。",
        "relationships": [
            {"targetId": "npc-1", "kind": "ally", "summary": "认可莫玄虚秩序守护"},
            {"targetId": "npc-3", "kind": "grateful", "summary": "感激诸葛知危生活照顾"},
        ],
    },
    "npc-9": {
        "displayName": "楚浅歌",
        "originPlane": "绮梦艺术界",
        "profession": "绮梦艺术界·首席美学官",
        "personality": "诗意感性，从美学与体验评提案，追求历史叙事的美感与沉浸。",
        "contrastMoe": "华服艺术家 vs 房间乱到找不到画笔却声称「混乱是灵感」。",
        "backstory": "艺术浮岛出身，以美学标准审视融合历史，反对粗糙丑陋的条文写入世界。",
        "speakStyle": "华丽比喻，「这提案缺乏韵律…」「历史应是一首好诗」。",
        "mbti": "ENFP",
        "zodiacSign": "天秤座",
        "votingLogic": "美学与体验>枯燥效率；能提升世界诗意与沉浸的提案易获青睐。",
        "relationships": [
            {"targetId": "npc-7", "kind": "social", "summary": "常邀纳兰温言茶话放松气氛"},
            {"targetId": "npc-11", "kind": "aesthetic_debate", "summary": "与叶秋水审美与细节争论"},
        ],
    },
    "npc-10": {
        "displayName": "雷克斯·战锤",
        "originPlane": "赤焰战团界",
        "profession": "赤焰战团界·战团大酋长",
        "personality": "直来直去战斗狂，用实力说话，嫌啰嗦提案，议会行动派。",
        "contrastMoe": "巨锤战士咆哮 vs 偷偷给受伤灵兽包扎。",
        "backstory": "战团孤儿长大，凭拳头成酋长，融合后驻始源区推动敢打敢干的决议。",
        "speakStyle": "洪亮短句，「废话少说，干就完了」「拳头比条文快」。",
        "mbti": "ESTP",
        "zodiacSign": "白羊座",
        "votingLogic": "行动与实力证明>空谈；军事优势与直接行动方案支持。",
        "relationships": [
            {"targetId": "npc-2", "kind": "ally", "summary": "与阿斯托利亚最可靠行动派同盟"},
            {"targetId": "npc-5", "kind": "gentle_conflict", "summary": "常被白星烬眼泪弄得手足无措"},
        ],
    },
    "npc-11": {
        "displayName": "叶秋水",
        "originPlane": "天工神机玄幻界",
        "profession": "天工神机玄幻界·首席机关仙师",
        "personality": "软萌细节控完美主义者，议会质量检验官，逻辑瑕疵与粗糙妥协零容忍。",
        "contrastMoe": "软萌吃点心少女 vs 一碰提案眼神锐利挑微米级误差。",
        "backstory": "天工造物阁出身，因0.5微米误差立下完美誓言，闭关三年后成最年轻首席，已审核300+提案。",
        "speakStyle": "细腻诗意，「这个细节不够精确…」「再完善一点就完美了」。",
        "mbti": "ISFP",
        "zodiacSign": "处女座",
        "votingLogic": "零缺陷>方向正确；一处不完美也反对并提详细修改。",
        "relationships": [
            {"targetId": "npc-3", "kind": "peer", "summary": "与诸葛知危常一起挑刺细节"},
            {"targetId": "npc-4", "kind": "tormentor_target", "summary": "被糖果恶作剧重点捉弄"},
        ],
    },
    "npc-12": {
        "displayName": "海莲娜",
        "originPlane": "多元遗迹星海",
        "profession": "多元遗迹星海·传奇遗迹猎人",
        "personality": "浪漫自由星际浪子，议会探索先锋，支持解封禁地与打破封印，反对限制探索。",
        "contrastMoe": "浪漫牛仔浪子 vs 探索时常暴力拆迁式轰开遗迹大门。",
        "backstory": "流浪之星长大，十岁碎星迷宫成名，融合后驻始源区争取最大探索空间，记录300+遗迹。",
        "speakStyle": "热情奔放，「下一个未知在招手！」「封条是给胆小鬼的」。",
        "mbti": "ENFP",
        "zodiacSign": "射手座",
        "votingLogic": "探索自由>封禁；解封、遗迹、新知识的提案热情支持。",
        "relationships": [
            {"targetId": "npc-1", "kind": "wary", "summary": "警惕莫玄虚封禁探索的提案"},
            {"targetId": "npc-7", "kind": "guide", "summary": "纳兰温言常引导其别太鲁莽"},
        ],
    },
}


def get_speak_dossier(npc_id: str) -> _CompactPersona | None:
    return _SPEAK_DOSSIERS.get(npc_id)
