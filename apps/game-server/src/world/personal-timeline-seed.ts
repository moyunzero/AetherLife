/**
 * Personal timeline seed on room create (BIO-04 / D-SEED-01…05).
 * Skeleton insert only — no sync LLM; polish enqueued async.
 *
 * Pre-arrival lifeNodes use `生平·{age}` labels (not 太乙).
 * 太乙元年 = 12-NPC gather start — reserved for post-arrival entries.
 */

import {
  COUNCIL_NPC_IDS,
  formatLifetimeCalendarLabel,
  getPersona,
  lifetimeEpochMinute,
  type CouncilLifeNode,
  type CouncilPersona,
  type PersonalTimelineTag,
} from "@aetherlife/shared";
import { enqueuePersonalTimelinePolishJob } from "../queue/personal-timeline.js";
import {
  insertPersonalTimelineEntry,
  listPersonalTimelineForNpc,
  updatePersonalTimelineBody,
  updatePersonalTimelineCalendarStamp,
} from "./personal-timeline-repository.js";

const seedInflight = new Map<string, Promise<void>>();
const seedReadyRooms = new Set<string>();

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

const SKELETON_OATH_MARKER = "将此铭记于心，以为立身之基";

/** Fact skeleton + one persona-specific line — no shared oath. Polish LLM expands async. */
export function skeletonFirstPerson(
  persona: CouncilPersona,
  node: CouncilLifeNode,
): string {
  const stance = (persona.stanceManifestoShort || "").trim();
  const color = stance
    ? stance.length > 36
      ? `${stance.slice(0, 36)}…`
      : stance
    : `${persona.displayName}记下这一笔。`;
  return `那年${node.age}，${node.event}。我，${persona.displayName}——${color}`;
}

function looksUnpolishedSkeleton(body: string): boolean {
  const t = body.trim();
  if (t.includes(SKELETON_OATH_MARKER)) return true;
  // Old fact-only stub after oath strip: 「那年…。」 with no persona line yet.
  if (/^那年.+。$/.test(t) && !t.includes("——") && t.length < 50) return true;
  return false;
}

function lifeNodeKey(npcId: string, index: number): string {
  return `life-node:${npcId}:${index}`;
}

/** Rewrite stale 太乙-stamped seeds to 生平·{age} (UAT dual-track revise). */
async function repairSeedLifetimeLabels(
  roomId: string,
  npcId: string,
  nodes: CouncilLifeNode[],
  existing: Awaited<
    ReturnType<typeof listPersonalTimelineForNpc>
  >["entries"],
): Promise<void> {
  for (const [i, node] of nodes.entries()) {
    const key = lifeNodeKey(npcId, i);
    const entry = existing.find(
      (e) => e.source === "seed" && e.eventAnchorId === key,
    );
    if (!entry) continue;
    const wantLabel = formatLifetimeCalendarLabel(node.age);
    const wantEpoch = lifetimeEpochMinute(i);
    if (
      entry.calendarLabel === wantLabel &&
      entry.aetherEpochMinute === wantEpoch
    ) {
      continue;
    }
    await updatePersonalTimelineCalendarStamp({
      roomId,
      entryId: entry.id,
      calendarLabel: wantLabel,
      aetherEpochMinute: wantEpoch,
    });
  }
}

/** Strip shared skeleton oath / refresh short stubs; re-enqueue polish. */
async function repairSeedSkeletonBodies(
  roomId: string,
  npcId: string,
  persona: CouncilPersona,
  nodes: CouncilLifeNode[],
  existing: Awaited<
    ReturnType<typeof listPersonalTimelineForNpc>
  >["entries"],
): Promise<void> {
  for (const [i, node] of nodes.entries()) {
    const key = lifeNodeKey(npcId, i);
    const entry = existing.find(
      (e) => e.source === "seed" && e.eventAnchorId === key,
    );
    if (!entry) continue;
    if (!looksUnpolishedSkeleton(entry.body)) continue;

    const body = skeletonFirstPerson(persona, node);
    if (entry.body !== body) {
      await updatePersonalTimelineBody({
        roomId,
        entryId: entry.id,
        body,
      });
    }
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
        "[personal-timeline-polish] re-enqueue after skeleton repair failed",
        roomId,
        npcId,
        err,
      );
    });
  }
}

async function seedPersonalTimelineInner(roomId: string): Promise<void> {
  const insertsDone = seedReadyRooms.has(roomId);

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
    await repairSeedLifetimeLabels(roomId, npcId, nodes, existing);
    await repairSeedSkeletonBodies(roomId, npcId, persona, nodes, existing);

    if (insertsDone) continue;

    const seedAnchors = new Set(
      existing
        .filter((e) => e.source === "seed" && e.eventAnchorId)
        .map((e) => e.eventAnchorId!),
    );
    const seedCount = existing.filter((e) => e.source === "seed").length;
    if (
      seedCount >= nodes.length &&
      nodes.every((_, i) => seedAnchors.has(lifeNodeKey(npcId, i)))
    ) {
      continue;
    }
    allReady = false;

    for (const [i, node] of nodes.entries()) {
      const key = lifeNodeKey(npcId, i);
      if (seedAnchors.has(key)) continue;

      const calendarLabel = formatLifetimeCalendarLabel(node.age);
      const tag = tagFromLifeNodeEvent(node.event);
      const body = skeletonFirstPerson(persona, node);

      const entry = await insertPersonalTimelineEntry({
        roomId,
        npcId,
        calendarLabel,
        aetherEpochMinute: lifetimeEpochMinute(i),
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

  if (insertsDone || allReady) {
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
