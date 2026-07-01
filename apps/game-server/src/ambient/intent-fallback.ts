import { activityDisplayZh } from "@aetherlife/shared";
import type { Mobility } from "./schedule.js";

/** Per-NPC voice pools — motivation/emotion only; never activity paraphrase. */
const ZONE_SUFFIX = (zoneId: string): string => {
  const idx = zoneId.lastIndexOf(":");
  return idx >= 0 ? zoneId.slice(idx + 1) : zoneId;
};

const NPC_ZONE_POOLS: Record<string, Record<string, string[]>> = {
  "npc-1": {
    orchard: ["心里还惦记着件事", "想先把思路理清楚", "今天适合慢慢琢磨"],
    plaza: ["想听听大家最近在忙啥", "出来透口气也好", "说不定能碰见熟人"],
    default: ["先把念头安放好", "这会儿不想被打扰"],
  },
  "npc-2": {
    orchard: ["手头的活计得抓紧", "得把该办的事列清楚", "今天要把节奏稳住"],
    plaza: ["看看有没有能帮上忙的", "走动走动心里踏实", "想跟人说两句家常"],
    default: ["先把正事想好", "心里有个数才安心"],
  },
  "npc-3": {
    orchard: ["有话想直说就别憋着", "先把该问的问清楚", "今天得把话说在前头"],
    plaza: ["看看广场里有什么新鲜事", "有事就当面讲明白", "不想错过碰面的机会"],
    default: ["直来直去省得误会", "先把想法说清楚"],
  },
  "npc-4": {
    orchard: ["今天想搞点有趣的动静", "说不定能黑出点乐子", "灵感来了挡都挡不住"],
    plaza: ["广场越热闹越有意思", "看看谁能被逗乐", "超级有趣的对吧"],
    default: ["无聊才是最大Bug", "先找点好玩的点子"],
  },
  "npc-5": {
    orchard: ["想听听风里的哭声", "若能以歌声换片刻安宁", "生灵也需要被倾听"],
    plaza: ["出来走走心会软一点", "想替弱小的人说句话", "和平比争吵更珍贵"],
    default: ["别让眼泪白流", "温柔也能守住底线"],
  },
  "npc-6": {
    orchard: ["得先算算这笔账划不划算", "情报比情绪更值钱", "每一步都要有回报"],
    plaza: ["看看有没有可交换的筹码", "人脉也是资源", "互惠条款得先谈好"],
    default: ["账本永远要厚实", "风险收益得算清楚"],
  },
  "npc-7": {
    orchard: ["不妨换个角度想想", "或许能找到折中办法", "先听听各方难处"],
    plaza: ["出来聊聊也许能缓和", "大家都还想继续对话", "平衡点往往藏在中间"],
    default: ["别让局面彻底破裂", "和谈比翻脸划算"],
  },
  "npc-8": {
    orchard: ["得先确认大家还安全", "让我看看有没有隐患", "守护比冒进更重要"],
    plaza: ["出来走走顺便照看一下", "同伴平安才安心", "喝口热茶冷静一下"],
    default: ["家园安稳是底线", "让我先挡在前面"],
  },
  "npc-9": {
    orchard: ["这里要是更美就好了", "舒服一点灵感才来", "生活品质不能将就"],
    plaza: ["广场气氛得再浪漫些", "沉重的事先放一放", "美与快乐才值得回味"],
    default: ["太丑太累就回家躺平", "先让自己舒服一点"],
  },
  "npc-10": {
    orchard: ["今天得找点刺激的", "不动起来浑身难受", "碰撞才证明自己活着"],
    plaza: ["广场里谁不服来战", "这地方还不够痛快", "引擎轰鸣才像活着"],
    default: ["冒险比安稳带劲", "先热热身再说"],
  },
  "npc-11": {
    orchard: ["细节还得再抠一抠", "这里还有微米级隐患", "再完善一点就完美了"],
    plaza: ["广场布局也得讲究", "粗糙提案是对未来的侮辱", "精密才经得起时间"],
    default: ["差不多可不行", "瑕疵必须当场修正"],
  },
  "npc-12": {
    orchard: ["那边说不定有新世界", "封条是给胆小鬼的", "说走就走才像冒险"],
    plaza: ["广场只是探险起点", "未知比安稳更诱人", "下一段旅程在招手"],
    default: ["探索权不能丢", "自由灵魂不该被拴住"],
  },
};

function poolFor(npcId: string, zoneId: string): string[] {
  const byNpc = NPC_ZONE_POOLS[npcId];
  if (!byNpc) {
    return NPC_ZONE_POOLS["npc-1"]!.default ?? ["心里有点事"];
  }
  const suffix = ZONE_SUFFIX(zoneId);
  return byNpc[suffix] ?? byNpc.default ?? byNpc.orchard ?? ["心里有点事"];
}

function stableIndex(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % size;
}

/**
 * Rule-based motivation reasonZh at segment start (before async LLM).
 * 12–18 chars; must not match activityDisplayZh for activityKey.
 */
export function pickIntentFallbackReasonZh(
  npcId: string,
  zoneId: string,
  activityKey: string,
  _mobility?: Mobility,
): string {
  const pool = poolFor(npcId, zoneId);
  const seed = `${npcId}|${zoneId}|${activityKey}`;
  let pick = pool[stableIndex(seed, pool.length)]!;
  const activityLabel = activityDisplayZh(activityKey);
  if (activityLabel && pick.includes(activityLabel.replace(/^在/, ""))) {
    pick = pool[(stableIndex(seed, pool.length) + 1) % pool.length]!;
  }
  return pick.slice(0, 18);
}
