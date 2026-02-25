import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CreditTracker } from "../src/credit-tracker.js";
import { MemoryStore } from "../src/memory-store.js";
import { creditWeightedSearch } from "../src/retrieval.js";
import { createTempMemoryDir, removeDir } from "./test-helpers.js";

const dirs: string[] = [];
const trackers: CreditTracker[] = [];

afterEach(async () => {
  while (trackers.length) {
    trackers.pop()?.close();
  }
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) {
      await removeDir(dir);
    }
  }
});

describe("creditWeightedSearch", () => {
  it("combines relevance and credit scores for ranking", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);

    const store = new MemoryStore(memoryDir);
    const dbPath = path.join(memoryDir, "engine.db");
    const tracker = new CreditTracker(dbPath, { alpha: 0.5 });
    trackers.push(tracker);

    const highRelevance = await store.storeEntity(
      "projects",
      "nanobrain-search",
      "search strategy details",
      ["search"],
    );
    const highCredit = await store.storeEntity(
      "projects",
      "nanobrain-ranking",
      "ranking strategy details",
      ["search"],
    );

    tracker.recordRetrieval("r-1", [highCredit.id]);
    tracker.applyOutcome("r-1", "task_completed");

    const results = await creditWeightedSearch("search", store, tracker, 2);
    expect(results).toHaveLength(2);
    expect(results[0]?.combinedScore).toBeGreaterThanOrEqual(results[1]?.combinedScore ?? -Infinity);
    expect([highRelevance.id, highCredit.id]).toContain(results[0]?.id);
  });
});
