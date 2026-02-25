import { describe, expect, it } from "vitest";

import { detectContradiction } from "../src/contradiction.js";
import { MemoryEntry } from "../src/types.js";

function entity(id: string, content: string): MemoryEntry {
  return {
    id,
    type: "entity",
    category: "projects",
    name: id,
    path: `entities/projects/${id}.md`,
    content,
    tags: [],
    created: "2026-02-25T00:00:00.000Z",
    updated: "2026-02-25T00:00:00.000Z",
    pinned: false,
  };
}

describe("contradiction", () => {
  it("flags contradictions when negation polarity differs", () => {
    const result = detectContradiction("Feature is not enabled.", [
      entity("proj-a", "Feature is enabled."),
    ]);
    expect(result.hasContradiction).toBe(true);
    expect(result.conflictingId).toBe("proj-a");
  });

  it("returns no contradiction for matching polarity", () => {
    const result = detectContradiction("Feature is enabled.", [
      entity("proj-a", "Feature is enabled in staging."),
    ]);
    expect(result.hasContradiction).toBe(false);
  });
});
