import fs from "node:fs/promises";
import path from "node:path";

import { formatFrontmatter, parseFrontmatter } from "./frontmatter.js";
import { MemoryEntry, MemoryFrontmatter, MemoryType, SearchResult } from "./types.js";

export class MemoryStore {
  constructor(private readonly memoryDir: string) {}

  async storeEntity(
    category: string,
    name: string,
    content: string,
    tags: string[] = [],
    pinned = false,
  ): Promise<{ id: string; path: string; created: true }> {
    const id = `entity-${category}-${name}`;
    const relativePath = path.join("entities", category, `${name}.md`);
    await this.writeNewEntry(relativePath, {
      id,
      type: "entity",
      category,
      tags,
      pinned,
      content,
    });

    return { id, path: relativePath, created: true };
  }

  async storeEpisode(
    slug: string,
    content: string,
    tags: string[] = [],
    pinned = false,
    now = new Date(),
  ): Promise<{ id: string; path: string; created: true }> {
    const month = now.toISOString().slice(0, 7);
    const [year, mm] = month.split("-");
    const id = `episode-${year}-${mm}-${slug}`;
    const relativePath = path.join("episodes", month, `${slug}.md`);
    await this.writeNewEntry(relativePath, {
      id,
      type: "episode",
      category: month,
      tags,
      pinned,
      content,
    });

    return { id, path: relativePath, created: true };
  }

  async retrieve(id: string): Promise<MemoryEntry> {
    const relativePath = await this.findPathById(id);
    if (!relativePath) {
      throw new Error(`Memory not found: ${id}`);
    }

    return this.loadEntryByPath(relativePath);
  }

  async update(id: string, content: string): Promise<MemoryEntry> {
    const relativePath = await this.findPathById(id);
    if (!relativePath) {
      throw new Error(`Memory not found: ${id}`);
    }

    const absolutePath = path.join(this.memoryDir, relativePath);
    const existingRaw = await fs.readFile(absolutePath, "utf8");
    const parsed = parseFrontmatter(existingRaw);
    const updatedFrontmatter: MemoryFrontmatter = {
      ...parsed.frontmatter,
      updated: new Date().toISOString(),
    };

    const fileContent = `${formatFrontmatter(updatedFrontmatter)}\n\n${content.trim()}\n`;
    await fs.writeFile(absolutePath, fileContent, "utf8");
    return this.loadEntryByPath(relativePath);
  }

  async search(
    query: string,
    type?: MemoryType,
    limit = 20,
  ): Promise<SearchResult[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const entries = await this.loadAllEntries(type);
    const matches = entries
      .map((entry) => {
        const lowerName = entry.name.toLowerCase();
        const lowerTags = entry.tags.map((tag) => tag.toLowerCase());
        const lowerContent = entry.content.toLowerCase();

        let relevance = 0;
        if (lowerName.includes(normalized)) {
          relevance = Math.max(relevance, 1.0);
        }
        if (lowerTags.some((tag) => tag.includes(normalized))) {
          relevance = Math.max(relevance, 0.8);
        }
        if (lowerContent.includes(normalized)) {
          relevance = Math.max(relevance, 0.5);
        }

        return {
          ...entry,
          relevanceScore: relevance,
        };
      })
      .filter((entry) => entry.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, Math.max(1, Math.min(100, limit)));

    return matches;
  }

  async delete(id: string): Promise<{ id: string; archived: true; archivePath: string }> {
    const relativePath = await this.findPathById(id);
    if (!relativePath) {
      throw new Error(`Memory not found: ${id}`);
    }

    const entry = await this.loadEntryByPath(relativePath);
    if (entry.pinned) {
      throw new Error(`Cannot archive pinned memory: ${id}`);
    }

    const sourcePath = path.join(this.memoryDir, relativePath);
    const archivePath = path.join("archive", relativePath);
    const absoluteArchivePath = path.join(this.memoryDir, archivePath);
    await fs.mkdir(path.dirname(absoluteArchivePath), { recursive: true });
    await fs.rename(sourcePath, absoluteArchivePath);

    return { id, archived: true, archivePath };
  }

  private async writeNewEntry(
    relativePath: string,
    args: {
      id: string;
      type: MemoryType;
      category: string;
      tags: string[];
      pinned: boolean;
      content: string;
    },
  ): Promise<void> {
    const absolutePath = path.join(this.memoryDir, relativePath);
    try {
      await fs.stat(absolutePath);
      throw new Error(`Memory already exists at ${relativePath}. Use update instead.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const now = new Date().toISOString();
    const frontmatter: MemoryFrontmatter = {
      id: args.id,
      type: args.type,
      category: args.category,
      tags: args.tags,
      created: now,
      updated: now,
      pinned: args.pinned,
    };

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const fileContent = `${formatFrontmatter(frontmatter)}\n\n${args.content.trim()}\n`;
    await fs.writeFile(absolutePath, fileContent, "utf8");
  }

  private async findPathById(id: string): Promise<string | null> {
    const files = await this.memoryMarkdownFiles();
    for (const absolutePath of files) {
      const relativePath = path.relative(this.memoryDir, absolutePath);
      if (relativePath.startsWith(`archive${path.sep}`)) {
        continue;
      }

      const raw = await fs.readFile(absolutePath, "utf8");
      const parsed = parseFrontmatter(raw);
      if (parsed.frontmatter.id === id) {
        return relativePath;
      }
    }

    return null;
  }

  private async loadAllEntries(type?: MemoryType): Promise<MemoryEntry[]> {
    const files = await this.memoryMarkdownFiles();
    const entries: MemoryEntry[] = [];

    for (const absolutePath of files) {
      const relativePath = path.relative(this.memoryDir, absolutePath);
      if (relativePath.startsWith(`archive${path.sep}`)) {
        continue;
      }

      const entry = await this.loadEntryByPath(relativePath);
      if (type && entry.type !== type) {
        continue;
      }
      entries.push(entry);
    }

    return entries;
  }

  private async loadEntryByPath(relativePath: string): Promise<MemoryEntry> {
    const absolutePath = path.join(this.memoryDir, relativePath);
    const raw = await fs.readFile(absolutePath, "utf8");
    const parsed = parseFrontmatter(raw);
    const fileName = path.basename(relativePath, ".md");

    return {
      id: parsed.frontmatter.id,
      type: parsed.frontmatter.type,
      category: parsed.frontmatter.category,
      name: fileName,
      path: relativePath,
      content: parsed.content,
      tags: parsed.frontmatter.tags,
      created: parsed.frontmatter.created,
      updated: parsed.frontmatter.updated,
      pinned: parsed.frontmatter.pinned,
    };
  }

  private async memoryMarkdownFiles(): Promise<string[]> {
    const collected: string[] = [];
    const stack = [this.memoryDir];

    while (stack.length > 0) {
      const currentDir = stack.pop();
      if (!currentDir) {
        continue;
      }

      const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of dirEntries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          continue;
        }

        const relativePath = path.relative(this.memoryDir, absolutePath);
        if (relativePath === "MEMORY.md" || relativePath === "STRATEGY.md") {
          continue;
        }
        collected.push(absolutePath);
      }
    }

    return collected;
  }
}
