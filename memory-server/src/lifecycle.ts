import fs from "node:fs/promises";
import path from "node:path";

import { CreditTracker } from "./credit-tracker.js";
import { MemoryStore } from "./memory-store.js";
import { MemoryEntry } from "./types.js";

export interface LifecycleReport {
  consolidated: number;
  promoted: number;
  pruned: number;
  details: string[];
}

export async function consolidate(
  memoryStore: MemoryStore,
  creditTracker: CreditTracker,
): Promise<{ consolidated: number; details: string[] }> {
  const episodes = await memoryStore.list("episode");
  const byDay = new Map<string, MemoryEntry[]>();
  for (const episode of episodes) {
    const day = episode.created.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day)?.push(episode);
  }

  let consolidated = 0;
  const details: string[] = [];

  for (const [day, dayEpisodes] of byDay) {
    if (dayEpisodes.length < 2) {
      continue;
    }

    const clusters: MemoryEntry[][] = [];
    const visited = new Set<string>();

    for (const episode of dayEpisodes) {
      if (visited.has(episode.id)) {
        continue;
      }
      const cluster = [episode];
      visited.add(episode.id);

      for (const peer of dayEpisodes) {
        if (visited.has(peer.id)) {
          continue;
        }
        if (tagOverlap(cluster, peer) > 0) {
          cluster.push(peer);
          visited.add(peer.id);
        }
      }

      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }

    for (const cluster of clusters) {
      const mergedTags = [...new Set(cluster.flatMap((entry) => entry.tags))];
      const mergedContent = cluster
        .map((entry) => `## ${entry.name}\n\n${entry.content.trim()}`)
        .join("\n\n");
      const mergedSlug = `${cluster[0]?.name ?? "episode"}-merged-${Date.now()}`;
      const mergedDate = new Date(`${day}T12:00:00.000Z`);

      const created = await memoryStore.storeEpisode(
        mergedSlug,
        `# Consolidated Episode (${day})\n\n${mergedContent}`,
        mergedTags,
        cluster.some((entry) => entry.pinned),
        mergedDate,
      );

      const summedScore = cluster
        .map((entry) => creditTracker.getScore(entry.id))
        .reduce((acc, score) => acc + score, 0);
      const mergedScore = Math.min(1, summedScore);
      creditTracker.ensureRecord(created.id);
      creditTracker.db
        .prepare("UPDATE credit_records SET score = ? WHERE id = ?")
        .run(mergedScore, created.id);

      for (const oldEntry of cluster) {
        await memoryStore.delete(oldEntry.id);
        creditTracker.db.prepare("DELETE FROM credit_records WHERE id = ?").run(oldEntry.id);
      }

      consolidated += 1;
      details.push(
        `Merged ${cluster.length} episodes on ${day} into ${created.id} (score: ${mergedScore.toFixed(3)})`,
      );
    }
  }

  return { consolidated, details };
}

export async function promote(
  memoryStore: MemoryStore,
  creditTracker: CreditTracker,
): Promise<{ promoted: number; details: string[] }> {
  const episodes = await memoryStore.list("episode");
  const promotedEpisodeIds = getAlreadyPromotedEpisodeIds(creditTracker);
  let promoted = 0;
  const details: string[] = [];

  for (const episode of episodes) {
    if (promotedEpisodeIds.has(episode.id)) {
      continue;
    }

    const score = creditTracker.getScore(episode.id);
    if (score <= 0.7) {
      continue;
    }

    const bulletFacts = episode.content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));
    if (bulletFacts.length === 0) {
      continue;
    }

    const entityName = `promoted-${episode.name}`;
    const entityId = `entity-projects-${entityName}`;
    const promotedContent = [
      `# Promoted from ${episode.name}`,
      "",
      ...bulletFacts,
    ].join("\n");
    const now = new Date().toISOString();

    try {
      await memoryStore.storeEntity("projects", entityName, promotedContent, [
        ...episode.tags,
        "promoted",
      ]);
    } catch {
      const existing = await memoryStore.retrieve(entityId);
      const existingLines = new Set(
        existing.content
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
      const missingFacts = bulletFacts.filter((fact) => !existingLines.has(fact));
      if (missingFacts.length > 0) {
        await memoryStore.update(
          entityId,
          `${existing.content.trim()}\n${missingFacts.join("\n")}`,
        );
      }
    }

    creditTracker.ensureRecord(entityId);
    const existingScore = creditTracker.getScore(entityId);
    const transferred = Math.min(1, existingScore + score * 0.25);
    creditTracker.db
      .prepare("UPDATE credit_records SET score = ? WHERE id = ?")
      .run(transferred, entityId);
    // Demote source episode below promotion threshold after transfer.
    creditTracker.db
      .prepare("UPDATE credit_records SET score = ? WHERE id = ?")
      .run(Math.min(score, 0.69), episode.id);
    creditTracker.db
      .prepare("INSERT INTO lifecycle_log(action, target_ids, details, created_at) VALUES(?, ?, ?, ?)")
      .run(
        "promote",
        JSON.stringify([episode.id, entityId]),
        `Promoted facts from ${episode.id} into ${entityId}`,
        now,
      );
    promotedEpisodeIds.add(episode.id);

    promoted += 1;
    details.push(
      `Promoted ${bulletFacts.length} facts from ${episode.id} to ${entityId} (score: ${transferred.toFixed(3)})`,
    );
  }

  return { promoted, details };
}

export async function prune(
  memoryStore: MemoryStore,
  creditTracker: CreditTracker,
  threshold = 0.2,
): Promise<{ pruned: number; details: string[] }> {
  const lowScored = creditTracker
    .getTopScored(10_000)
    .filter((record) => record.score < threshold)
    .sort((a, b) => a.score - b.score);

  let pruned = 0;
  const details: string[] = [];

  for (const record of lowScored) {
    if (record.id.startsWith("entity-people-")) {
      continue;
    }

    try {
      await memoryStore.delete(record.id);
      pruned += 1;
      details.push(`Archived ${record.id} (score: ${record.score.toFixed(3)})`);
    } catch {
      // Skip unresolvable entries for now.
    }
  }

  return { pruned, details };
}

export async function memoryCompact(
  memoryStore: MemoryStore,
  creditTracker: CreditTracker,
): Promise<LifecycleReport> {
  const merged = await consolidate(memoryStore, creditTracker);
  const promoted = await promote(memoryStore, creditTracker);
  const pruned = await prune(memoryStore, creditTracker);

  return {
    consolidated: merged.consolidated,
    promoted: promoted.promoted,
    pruned: pruned.pruned,
    details: [...merged.details, ...promoted.details, ...pruned.details],
  };
}

export async function readStrategy(strategyPath: string): Promise<string> {
  try {
    const absolute = path.resolve(strategyPath);
    return await fs.readFile(absolute, "utf8");
  } catch {
    return "";
  }
}

function tagOverlap(cluster: MemoryEntry[], candidate: MemoryEntry): number {
  const clusterTags = new Set(cluster.flatMap((entry) => entry.tags));
  return candidate.tags.filter((tag) => clusterTags.has(tag)).length;
}

function getAlreadyPromotedEpisodeIds(creditTracker: CreditTracker): Set<string> {
  const rows = creditTracker.db
    .prepare("SELECT target_ids FROM lifecycle_log WHERE action = 'promote'")
    .all() as Array<{ target_ids: string }>;

  const promoted = new Set<string>();
  for (const row of rows) {
    try {
      const ids = JSON.parse(row.target_ids) as string[];
      for (const id of ids) {
        if (typeof id === "string" && id.startsWith("episode-")) {
          promoted.add(id);
        }
      }
    } catch {
      // Ignore malformed legacy rows.
    }
  }
  return promoted;
}
