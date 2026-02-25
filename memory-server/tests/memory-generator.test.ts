import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CreditTracker } from "../src/credit-tracker.js";
import { generateMemoryMd } from "../src/memory-generator.js";
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

describe("memory-generator", () => {
  it("writes MEMORY.md from top-scored entries", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);
    const tracker = new CreditTracker(path.join(memoryDir, "engine.db"), { alpha: 0.5 });
    trackers.push(tracker);

    const person = await store.storeEntity("people", "alice", "ML engineer");
    const project = await store.storeEntity("projects", "nanobrain", "CLI memory assistant");

    tracker.recordRetrieval("g-1", [person.id]);
    tracker.applyOutcome("g-1", "task_completed");

    tracker.recordRetrieval("g-2", [project.id]);
    tracker.applyOutcome("g-2", "user_correction");

    const outputPath = await generateMemoryMd(memoryDir, store, tracker, 5000);
    const content = await fs.readFile(outputPath, "utf8");

    expect(content).toContain("# MEMORY");
    expect(content).toContain("## People");
    expect(content).toContain("alice");
  });
});
