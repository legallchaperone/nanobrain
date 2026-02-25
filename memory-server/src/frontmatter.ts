import { MemoryFrontmatter } from "./types.js";

function parseArray(raw: string): string[] {
  const value = raw.trim();
  if (!value.startsWith("[") || !value.endsWith("]")) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
    return [];
  } catch {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }

    // Fallback for legacy tag formats that are not strict JSON.
    return inner
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
}

export function parseFrontmatter(markdown: string): {
  frontmatter: MemoryFrontmatter;
  content: string;
} {
  if (!markdown.startsWith("---\n")) {
    throw new Error("Missing frontmatter block");
  }

  const parts = markdown.split("\n---\n");
  if (parts.length < 2) {
    throw new Error("Invalid frontmatter format");
  }
  const rawFrontmatter = parts[0]?.replace(/^---\n/, "") ?? "";
  const content = parts.slice(1).join("\n---\n").trim();
  const lines = rawFrontmatter.split("\n");
  const map = new Map<string, string>();

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }

  const id = map.get("id");
  const type = map.get("type");
  const category = map.get("category");
  const created = map.get("created");
  const updated = map.get("updated");
  const pinnedRaw = map.get("pinned");
  const tagsRaw = map.get("tags") ?? "[]";

  if (!id || !type || !category || !created || !updated || !pinnedRaw) {
    throw new Error("Incomplete frontmatter metadata");
  }

  if (type !== "entity" && type !== "episode") {
    throw new Error(`Invalid memory type: ${type}`);
  }

  const frontmatter: MemoryFrontmatter = {
    id,
    type,
    category,
    tags: parseArray(tagsRaw),
    created,
    updated,
    pinned: pinnedRaw.toLowerCase() === "true",
  };

  return { frontmatter, content };
}

export function formatFrontmatter(frontmatter: MemoryFrontmatter): string {
  const tags = `[${frontmatter.tags.map((tag) => JSON.stringify(tag)).join(", ")}]`;
  return [
    "---",
    `id: ${frontmatter.id}`,
    `type: ${frontmatter.type}`,
    `category: ${frontmatter.category}`,
    `tags: ${tags}`,
    `created: ${frontmatter.created}`,
    `updated: ${frontmatter.updated}`,
    `pinned: ${frontmatter.pinned}`,
    "---",
  ].join("\n");
}
