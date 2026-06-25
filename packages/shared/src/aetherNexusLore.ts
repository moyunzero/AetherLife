/**
 * World Lore seed — LOCKED per 23-CONTEXT.md <world_lore> (D-WORLD-04).
 * Chronicle genesis rows (Phase 24) source `origin` / `beginningFieldsRole` / `historyEvolution`.
 */

export type AetherNexusLore = {
  nameZh: string;
  nameEn: string;
  origin: string;
  beginningFieldsRole: string;
  historyEvolution: string;
  coreConflicts: string[];
};

export const AETHER_NEXUS_LORE: AetherNexusLore = {
  nameZh: "太乙万界交汇",
  nameEn: "Aether Nexus",
  origin: `上古之时，诸界并立，互不相通。东方有大夏修仙古界，剑气冲霄，仙门林立；西方有星辉魔导帝国，舰队横空，魔力如海；北地有狂飙废土荒原，机车轰鸣，强者为尊；南疆有永恒精灵自然界，古树参天，万灵共生。更有蒸汽纪元联邦、天工神机界、灰烬废土纪元、幻梦仙乐界、多元遗迹星海、天机玄算界等十二大独立位面，各秉天道，各有规则，亿万生灵于其中繁衍生息，演绎兴衰。

然天数有变，劫运骤生。

不知起于何年何月，诸界之间忽现无形裂隙。先是微不可察的灵气泄露，后是空间扭曲、时间错乱，再后则是位面壁障如琉璃般寸寸崩裂。世称此为「万界崩裂纪」。裂隙初现时，尚有大能试图以大法力封镇，然裂隙非人力可弥，反而越发扩大。最终，十二大位面如被无形巨力强行拉扯，剧烈碰撞、相互撕扯、部分重叠融合。

此劫浩大，诸界皆遭重创。

大夏修仙古界有三洲陆沉，仙山崩塌无数；星辉魔导帝国折损十三支主力舰队，皇都星域半壁焦土；狂飙废土荒原辐射风暴暴涨，亿万生灵化为灰烬；永恒精灵自然界世界树主干断裂，古木哀鸣，精灵王庭泣血……其余诸界亦各有惨烈，或天机算阵崩毁、或蒸汽核心爆炸、或遗迹星海航道尽断。

融合之初，规则冲突尤为剧烈。仙道灵气与魔导之力相互侵蚀，蒸汽机械在高灵环境失控爆炸，赛博数据流与天道因果相互污染，位面碎片如乱流般四处飘荡。生灵或因规则不适而异化，或因环境剧变而痛苦哀嚎。天地间哀鸿遍野，秩序近乎崩解。`,
  beginningFieldsRole: `然天地不绝生机。

在诸界碰撞最为剧烈之处，竟诞生了一片相对稳定的中立区域。此地灵气、魔力、机械能、数据流、星际航道等诸般力量奇异地达到微妙平衡，既不完全偏向任何一界，又能兼容诸界规则。诸界大能于劫后余生中察觉此地，乃共同议定将其辟为始源区，后世称 Beginning Fields。

始源区初成之时，尚是荒芜焦土，裂隙风暴不时肆虐。十二大位面为求共存、止息战乱、重建秩序，遂各自选派最强者，组建太乙议会，派驻使节常驻始源区，共同商议融合诸界的规则与未来。`,
  historyEvolution: `十二位使节各代表一方世界，携本界最高意志而来：

大夏律法剑阁镇界天尊莫玄虚，执掌秩序；
星辉魔导帝国第一远征军元帅阿斯托利亚，志在扩张；
天机玄算界量子占星术士诸葛知危，算尽因果；
霓虹数据域时空欺诈师糖果，嬉笑间搅动风云；
永恒精灵自然界灵魂歌姬白星烬，悲悯苍生；
灰烬废土纪元义体炼金王朝首脑瓦伦丁，权衡利益；
蒸汽纪元联邦首席外交官纳兰温言，平衡诸方；
圣辉骑士王国圣盾骑士团团长克里斯，守护家园；
幻梦仙乐界九尾幻术巨星楚浅歌，追求美与享乐；
狂飙废土荒原符文机车暴走女猎王斯卡蒂，渴求碰撞；
天工神机界首席机关仙师叶秋水，苛求完美；
多元遗迹星海传奇猎人海莲娜，追逐自由。

自此，始源区不再是单纯的缓冲之地，而是十二大位面共同的议事之所、规则制定之所、未来书写之所。

诸位使节初至之时，冲突不断。秩序与扩张、和平与战斗、保守与探索、完美与享乐……不同世界的理念如诸界碰撞般激烈交锋。然正因冲突，融合方才缓慢推进。无数次争论、妥协、甚至险些破裂的对峙之后，始源区逐渐有了最初的秩序框架：禁止无序战争、保护弱小生灵、共同管理危险遗迹、平衡诸界资源流动……

后世史家评曰：万界崩裂纪为劫，始源区辟为转，十二议会驻为定。

自太乙纪元年起，十二议会正式运作。诸位使节既是本界代表，亦逐渐成为融合世界之见证者。他们的一言一行、一场辩论、一纸决议，皆逐渐化作后世编年史中不可或缺的篇章。

此为太乙交汇界之始，亦为后世世界历史书写之根基。自此以后，历史不再由单一位面独断，而是由十二界共同见证、共同辩论、共同书写。无论辉煌、无论惨烈、无论温柔、无论残酷，皆将成为共同的记忆，镌刻于这座名为太乙交汇界的庞大舞台之上。`,
  coreConflicts: [
    "仙道秩序 vs 帝国扩张",
    "系统逻辑 vs 混乱乐子",
    "和平治愈 vs 废土进化",
    "守护稳定 vs 自由探索",
  ],
};

/** Player-facing name for the home map / diplomatic buffer zone (LOCKED Phase 23 UAT). */
export const BEGINNING_FIELDS_NAME_ZH = "始源区";

/** Internal English key — code comments, Tiled assets, spawn constants. */
export const BEGINNING_FIELDS_NAME_EN = "Beginning Fields";

/** Compact world summary for LLM/registry imports (≤200 中文字符). */
export function aetherNexusSummaryForPrompt(): string {
  const { nameZh, coreConflicts } = AETHER_NEXUS_LORE;
  return `${nameZh}：十二界劫后共治始源区，太乙议会常驻议和。当前核心冲突：${coreConflicts.join(" · ")}。`;
}
