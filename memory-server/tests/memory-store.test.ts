import { afterEach, describe, expect, it } from "vitest";

import { MemoryStore } from "../src/memory-store.js";
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

describe("memory-store", () => {
  it("stores and retrieves entities", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);

    const created = await store.storeEntity(
      "people",
      "alice-chen",
      "# Alice Chen\n\n- ML engineer",
      ["ml-team"],
    );
    expect(created.id).toBe("entity-people-alice-chen");

    const entry = await store.retrieve(created.id);
    expect(entry.type).toBe("entity");
    expect(entry.category).toBe("people");
    expect(entry.tags).toContain("ml-team");
    expect(entry.content).toContain("ML engineer");
  });

  it("updates an existing memory and preserves metadata", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);

    const created = await store.storeEntity("projects", "nanobrain", "v1 scope");
    const updated = await store.update(created.id, "v2 scope");

    expect(updated.id).toBe(created.id);
    expect(updated.content).toContain("v2 scope");
    expect(updated.created).toBeTruthy();
    expect(updated.updated).toBeTruthy();
  });

  it("searches by name, tags, and content with relevance score", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);

    await store.storeEntity("preferences", "typescript-style", "Use strict mode", ["typescript"]);
    await store.storeEntity("projects", "nanobrain", "Model agnostic assistant", ["assistant"]);

    const byTag = await store.search("typescript");
    expect(byTag[0]?.relevanceScore).toBeGreaterThan(0);
    expect(byTag[0]?.id).toBe("entity-preferences-typescript-style");

    const byContent = await store.search("agnostic");
    expect(byContent[0]?.id).toBe("entity-projects-nanobrain");
  });

  it("archives a memory on delete", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);
    const store = new MemoryStore(memoryDir);

    const created = await store.storeEntity("projects", "cleanup-target", "legacy");
    const deleted = await store.delete(created.id);

    expect(deleted.archived).toBe(true);
    await expect(store.retrieve(created.id)).rejects.toThrow(/not found/i);
  });
});
