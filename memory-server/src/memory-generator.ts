import fs from "node:fs/promises";
import path from "node:path";

import { CreditTracker } from "./credit-tracker.js";
import { allocateBudget } from "./context-budget.js";
import { MemoryStore } from "./memory-store.js";

export async function generateMemoryMd(
  memoryDir: string,
  memoryStore: MemoryStore,
  creditTracker: CreditTracker,
  maxTokens: number,
): Promise<string> {
  const top = creditTracker.getTopScored(500);
  const entries = [];

  for (const record of top) {
    try {
      const entry = await memoryStore.retrieve(record.id);
      entries.push({
        id: entry.id,
        score: record.score,
        type: entry.type,
        category: entry.category,
        name: entry.name,
        content: entry.content,
      });
    } catch {
      // Ignore missing files that may have been archived.
    }
  }

  const budgeted = allocateBudget(
    entries.map((entry) => ({
      id: entry.id,
      score: entry.score,
      content: entry.content,
    })),
    maxTokens,
  );

  const included = new Set(budgeted.map((entry) => entry.id));
  const selected = entries.filter((entry) => included.has(entry.id));

  const sections = {
    People: selected.filter((entry) => entry.id.startsWith("entity-people-")),
    Projects: selected.filter((entry) => entry.id.startsWith("entity-projects-")),
    Preferences: selected.filter((entry) => entry.id.startsWith("entity-preferences-")),
    "Recent Episodes": selected.filter((entry) => entry.type === "episode"),
  };

  const lines: string[] = ["# MEMORY", ""];
  if (selected.length === 0) {
    lines.push("No memories yet. I'll learn about you as we interact.", "");
  } else {
    for (const [title, sectionEntries] of Object.entries(sections)) {
      if (sectionEntries.length === 0) {
        continue;
      }
      lines.push(`## ${title}`, "");
      for (const entry of sectionEntries) {
        lines.push(`### ${entry.name}`);
        lines.push(`<!-- score: ${entry.score.toFixed(3)} -->`);
        lines.push(entry.content.trim(), "");
      }
    }
  }

  const output = lines.join("\n");
  const outPath = path.join(memoryDir, "MEMORY.md");
  await fs.writeFile(outPath, `${output}\n`, "utf8");
  return outPath;
}
