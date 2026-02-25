import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CreditTracker } from "../src/credit-tracker.js";
import { prune } from "../src/lifecycle.js";
import { MemoryStore } from "../src/memory-store.js";
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

describe("lifecycle.prune", () => {
  it("archives low-score non-people memories", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);
    const tracker = new CreditTracker(path.join(memoryDir, "engine.db"), { alpha: 0.5 });
    trackers.push(tracker);

    const project = await store.storeEntity("projects", "legacy-feature", "old details");
    const person = await store.storeEntity("people", "alice", "important person");

    tracker.recordRetrieval("s-1", [project.id]);
    tracker.applyOutcome("s-1", "user_correction");

    tracker.recordRetrieval("s-2", [person.id]);
    tracker.applyOutcome("s-2", "user_correction");

    const report = await prune(store, tracker, 0.2);
    expect(report.pruned).toBeGreaterThanOrEqual(1);

    await expect(store.retrieve(project.id)).rejects.toThrow(/not found/i);
    await expect(store.retrieve(person.id)).resolves.toBeTruthy();
  });
});
