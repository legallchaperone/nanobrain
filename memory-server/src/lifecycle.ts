import fs from "node:fs/promises";
import path from "node:path";

import { CreditTracker } from "./credit-tracker.js";
import { MemoryStore } from "./memory-store.js";

export interface LifecycleReport {
  consolidated: number;
  promoted: number;
  pruned: number;
  details: string[];
}

export async function consolidate(
  _memoryStore: MemoryStore,
  _creditTracker: CreditTracker,
): Promise<{ consolidated: number; details: string[] }> {
  return { consolidated: 0, details: [] };
}

export async function promote(
  _memoryStore: MemoryStore,
  _creditTracker: CreditTracker,
): Promise<{ promoted: number; details: string[] }> {
  return { promoted: 0, details: [] };
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
