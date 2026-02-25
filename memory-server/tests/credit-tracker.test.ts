import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CreditTracker } from "../src/credit-tracker.js";
import { createTempMemoryDir, removeDir } from "./test-helpers.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) {
      await removeDir(dir);
    }
  }
});

describe("credit-tracker", () => {
  it("initializes records and updates score on outcomes", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const dbPath = path.join(memoryDir, "engine.db");

    const tracker = new CreditTracker(dbPath, { alpha: 0.1 });
    tracker.ensureRecord("entity-people-alice-chen");
    tracker.recordRetrieval("session-1", ["entity-people-alice-chen"]);

    const before = tracker.getScore("entity-people-alice-chen");
    tracker.applyOutcome("session-1", "positive_feedback");
    const after = tracker.getScore("entity-people-alice-chen");

    expect(after).not.toBe(before);
    tracker.close();
  });

  it("returns top scored entries", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const dbPath = path.join(memoryDir, "engine.db");

    const tracker = new CreditTracker(dbPath, { alpha: 0.5 });
    tracker.ensureRecord("entity-projects-a");
    tracker.ensureRecord("entity-projects-b");

    tracker.recordRetrieval("session-2", ["entity-projects-a"]);
    tracker.applyOutcome("session-2", "task_completed");

    tracker.recordRetrieval("session-3", ["entity-projects-b"]);
    tracker.applyOutcome("session-3", "user_correction");

    const top = tracker.getTopScored(2);
    expect(top).toHaveLength(2);
    expect(top[0]?.score).toBeGreaterThanOrEqual(top[1]?.score ?? -Infinity);
    tracker.close();
  });

  it("applies score decay", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const dbPath = path.join(memoryDir, "engine.db");

    const tracker = new CreditTracker(dbPath);
    tracker.ensureRecord("entity-preferences-sample");

    const before = tracker.getScore("entity-preferences-sample");
    tracker.applyDecay(7);
    const after = tracker.getScore("entity-preferences-sample");

    expect(after).toBeLessThan(before);
    tracker.close();

    await expect(fs.stat(dbPath)).resolves.toBeTruthy();
  });
});
