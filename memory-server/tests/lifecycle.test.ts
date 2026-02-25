import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CreditTracker } from "../src/credit-tracker.js";
import { consolidate, promote, prune } from "../src/lifecycle.js";
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

describe("lifecycle.consolidate", () => {
  it("merges same-day episodes with overlapping tags", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);
    const tracker = new CreditTracker(path.join(memoryDir, "engine.db"), { alpha: 0.5 });
    trackers.push(tracker);

    const day = new Date("2026-02-20T10:00:00.000Z");
    const ep1 = await store.storeEpisode("debug-auth", "- fixed login", ["auth", "debug"], false, day);
    const ep2 = await store.storeEpisode("debug-session", "- traced token flow", ["auth"], false, day);

    tracker.ensureRecord(ep1.id);
    tracker.ensureRecord(ep2.id);

    const report = await consolidate(store, tracker);
    expect(report.consolidated).toBe(1);

    await expect(store.retrieve(ep1.id)).rejects.toThrow(/not found/i);
    await expect(store.retrieve(ep2.id)).rejects.toThrow(/not found/i);

    const episodes = await store.list("episode");
    const merged = episodes.find((entry) => entry.id.includes("merged"));
    expect(merged).toBeTruthy();
  });
});

describe("lifecycle.promote", () => {
  it("promotes high-score episodes into project entities", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);
    const tracker = new CreditTracker(path.join(memoryDir, "engine.db"), { alpha: 0.8 });
    trackers.push(tracker);

    const episode = await store.storeEpisode(
      "planning-sync",
      "# Session\n\n- user prefers short status updates\n- keep Docker setup simple",
      ["planning"],
      false,
      new Date("2026-02-21T10:00:00.000Z"),
    );

    tracker.recordRetrieval("s-promote", [episode.id]);
    tracker.applyOutcome("s-promote", "task_completed");
    tracker.db.prepare("UPDATE credit_records SET score = 0.9 WHERE id = ?").run(episode.id);

    const report = await promote(store, tracker);
    expect(report.promoted).toBeGreaterThanOrEqual(1);

    const entities = await store.list("entity");
    expect(entities.some((entry) => entry.id.startsWith("entity-projects-promoted-"))).toBe(true);
  });

  it("does not re-promote the same episode repeatedly", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);
    const tracker = new CreditTracker(path.join(memoryDir, "engine.db"), { alpha: 0.8 });
    trackers.push(tracker);

    const episode = await store.storeEpisode(
      "repeatable-promotion",
      "# Session\n\n- fact one\n- fact two",
      ["planning"],
      false,
      new Date("2026-02-22T10:00:00.000Z"),
    );

    tracker.ensureRecord(episode.id);
    tracker.db.prepare("UPDATE credit_records SET score = 0.9 WHERE id = ?").run(episode.id);

    const first = await promote(store, tracker);
    expect(first.promoted).toBe(1);

    const entityId = "entity-projects-promoted-repeatable-promotion";
    const afterFirst = await store.retrieve(entityId);
    const scoreAfterFirst = tracker.getScore(entityId);

    const second = await promote(store, tracker);
    expect(second.promoted).toBe(0);

    const afterSecond = await store.retrieve(entityId);
    const scoreAfterSecond = tracker.getScore(entityId);

    const factOneCount = (afterSecond.content.match(/- fact one/g) ?? []).length;
    const factTwoCount = (afterSecond.content.match(/- fact two/g) ?? []).length;

    expect(afterSecond.content).toBe(afterFirst.content);
    expect(scoreAfterSecond).toBe(scoreAfterFirst);
    expect(factOneCount).toBe(1);
    expect(factTwoCount).toBe(1);
  });
});
