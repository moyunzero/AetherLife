/**
 * Personal timeline seed on room create (BIO-04 / D-SEED-01…05).
 * Skeleton insert only — no sync LLM; polish enqueued async.
 */

import {
  AETHER_SEASONS,
  COUNCIL_NPC_IDS,
  DAYS_PER_MONTH,
  formatAetherCalendarLabel,
  getPersona,
  MINUTES_PER_DAY,
  type CouncilLifeNode,
  type CouncilPersona,
  type PersonalTimelineTag,
} from "@aetherlife/shared";
import { enqueuePersonalTimelinePolishJob } from "../queue/personal-timeline.js";
import {
  insertPersonalTimelineEntry,
  listPersonalTimelineForNpc,
} from "./personal-timeline-repository.js";

const seedInflight = new Map<string, Promise<void>>();
const seedReadyRooms = new Set<string>();

/** Deterministic civil stamp: spread lifeNode index across 太乙元年 months 1–12. */
export function seedCivilForIndex(
  index: number,
  total: number,
): {
  year: 0;
  season: (typeof AETHER_SEASONS)[number];
  month: number;
  dayOfMonth: number;
  aetherEpochMinute: number;
} {
  const n = Math.max(1, total);
  const i = Math.max(0, Math.min(index, n - 1));
  const month =
    n === 1 ? 1 : Math.min(12, Math.floor((i * 12) / n) + 1);
  const dayOfMonth = 1 + (i % 15);
  const season = AETHER_SEASONS[Math.floor((month - 1) / 3)]!;
  const aetherEpochMinute =
    (month - 1) * DAYS_PER_MONTH * MINUTES_PER_DAY +
    (dayOfMonth - 1) * MINUTES_PER_DAY;
  return { year: 0, season, month, dayOfMonth, aetherEpochMinute };
}

/** Heuristic map from lifeNode.event text → PERSONAL_TIMELINE_TAGS (D-SEED-05). */
export function tagFromLifeNodeEvent(event: string): PersonalTimelineTag {
  const t = event;
  if (/议会|议席|提案|廷议|表决/.test(t)) return "council";
  if (/父|母|同门|决裂|挚友|恋人|师|徒/.test(t)) return "relationship";
  if (/战|劫|镇压|斩|裂缝|邪神|入侵|对抗/.test(t)) return "conflict";
  if (/探索|跨界|远征|裂缝|秘境|旅/.test(t)) return "adventure";
  if (/悲|怒|惧|心魔|泪|悔|誓|痛/.test(t)) return "emotion";
  if (/记录|反思|顿悟|打坐|抄|悟/.test(t)) return "reflection";
  return "daily";
}

function skeletonFirstPerson(
  persona: CouncilPersona,
  node: CouncilLifeNode,
): string {
  return (
    `那年${node.age}，${node.event}。` +
    `我，${persona.displayName}，将此铭记于心，以为立身之基。`
  );
}

function lifeNodeKey(npcId: string, index: number): string {
  return `life-node:${npcId}:${index}`;
}

async function seedPersonalTimelineInner(roomId: string): Promise<void> {
  if (seedReadyRooms.has(roomId)) return;

  let allReady = true;
  for (const npcId of COUNCIL_NPC_IDS) {
    const persona = getPersona(npcId);
    const nodes = persona.lifeNodes ?? [];
    if (nodes.length === 0) continue;

    const { entries: existing } = await listPersonalTimelineForNpc({
      roomId,
      npcId,
      limit: 200,
    });
    const seedAnchors = new Set(
      existing
        .filter((e) => e.source === "seed" && e.eventAnchorId)
        .map((e) => e.eventAnchorId!),
    );
    const seedCount = existing.filter((e) => e.source === "seed").length;
    if (seedCount >= nodes.length && nodes.every((_, i) => seedAnchors.has(lifeNodeKey(npcId, i)))) {
      continue;
    }
    allReady = false;

    for (const [i, node] of nodes.entries()) {
      const key = lifeNodeKey(npcId, i);
      if (seedAnchors.has(key)) continue;

      const civil = seedCivilForIndex(i, nodes.length);
      const calendarLabel = formatAetherCalendarLabel(
        civil.year,
        civil.season,
        civil.month,
        civil.dayOfMonth,
      );
      const tag = tagFromLifeNodeEvent(node.event);
      const body = skeletonFirstPerson(persona, node);

      const entry = await insertPersonalTimelineEntry({
        roomId,
        npcId,
        calendarLabel,
        aetherEpochMinute: civil.aetherEpochMinute,
        tag,
        body,
        eventAnchorId: key,
        factualSummary: `${node.age}：${node.event}`,
        // D-PROP-01 / BIO-07: source=seed → computeProposalEligible false (no override).
        source: "seed",
      });

      // D-SEED-04 hybrid degrade: timeout=0 — skeleton visible immediately; polish async.
      void enqueuePersonalTimelinePolishJob({
        roomId,
        npcId,
        entryId: entry.id,
        lifeNodeKey: key,
        age: node.age,
        event: node.event,
        skeletonBody: body,
      }).catch((err) => {
        console.error(
          "[personal-timeline-polish] enqueue failed",
          roomId,
          npcId,
          err,
        );
      });
    }
  }

  if (allReady) {
    seedReadyRooms.add(roomId);
    return;
  }

  // Re-check after inserts
  let ready = true;
  for (const npcId of COUNCIL_NPC_IDS) {
    const nodes = getPersona(npcId).lifeNodes ?? [];
    const { entries } = await listPersonalTimelineForNpc({
      roomId,
      npcId,
      limit: 200,
    });
    const seedCount = entries.filter((e) => e.source === "seed").length;
    if (seedCount < nodes.length) {
      ready = false;
      break;
    }
  }
  if (ready) seedReadyRooms.add(roomId);
}

/**
 * Idempotent async seed of 1:1 lifeNode biography skeletons per council NPC.
 * No sync LLM — polish jobs enqueued for plan 04 worker.
 */
export async function seedPersonalTimelineIfNeeded(roomId: string): Promise<void> {
  let inflight = seedInflight.get(roomId);
  if (!inflight) {
    inflight = seedPersonalTimelineInner(roomId).finally(() => {
      seedInflight.delete(roomId);
    });
    seedInflight.set(roomId, inflight);
  }
  await inflight;
}

/** Test helper — clears in-process seed short-circuit. */
export function clearPersonalTimelineSeedCache(): void {
  seedReadyRooms.clear();
  seedInflight.clear();
}
