import { describe, expect, it } from "vitest";

import { formatFrontmatter, parseFrontmatter } from "../src/frontmatter.js";
import { MemoryFrontmatter } from "../src/types.js";

describe("frontmatter tags", () => {
  it("round-trips tags containing commas", () => {
    const frontmatter: MemoryFrontmatter = {
      id: "entity-projects-comma-tag",
      type: "entity",
      category: "projects",
      tags: ["hello,world", "plain-tag"],
      created: "2026-02-25T00:00:00.000Z",
      updated: "2026-02-25T00:00:00.000Z",
      pinned: false,
    };

    const markdown = `${formatFrontmatter(frontmatter)}\n\n# Content\n`;
    const parsed = parseFrontmatter(markdown);
    expect(parsed.frontmatter.tags).toEqual(["hello,world", "plain-tag"]);
  });
});
