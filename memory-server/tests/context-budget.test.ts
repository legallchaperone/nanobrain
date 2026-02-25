import { describe, expect, it } from "vitest";

import { allocateBudget } from "../src/context-budget.js";

describe("context-budget", () => {
  it("keeps highest-score entries that fit token limit", () => {
    const selected = allocateBudget(
      [
        { id: "a", score: 0.9, content: "x".repeat(200) }, // ~50 tokens
        { id: "b", score: 0.7, content: "x".repeat(120) }, // ~30 tokens
        { id: "c", score: 0.8, content: "x".repeat(160) }, // ~40 tokens
      ],
      80,
    );

    expect(selected.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("returns empty when budget is non-positive", () => {
    expect(allocateBudget([{ id: "a", score: 1, content: "abc" }], 0)).toEqual([]);
  });
});
