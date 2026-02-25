import path from "node:path";

import { CreditTracker } from "./credit-tracker.js";
import { memoryCompact } from "./lifecycle.js";
import { MemoryStore } from "./memory-store.js";
import { generateMemoryMd } from "./memory-generator.js";
import { creditWeightedSearch } from "./retrieval.js";

export interface MemoryServerContext {
  memoryDir: string;
  memoryStore: MemoryStore;
  creditTracker: CreditTracker;
}

export function createMemoryServer(memoryDir = process.env.MEMORY_DIR ?? path.resolve("memory")): MemoryServerContext {
  const memoryStore = new MemoryStore(memoryDir);
  const creditTracker = new CreditTracker(path.join(memoryDir, "engine.db"));
  return { memoryDir, memoryStore, creditTracker };
}

export async function runHealthcheck(memoryDir?: string): Promise<void> {
  const ctx = createMemoryServer(memoryDir);
  await generateMemoryMd(ctx.memoryDir, ctx.memoryStore, ctx.creditTracker, 5000);
  await creditWeightedSearch("memory", ctx.memoryStore, ctx.creditTracker, 1);
  await memoryCompact(ctx.memoryStore, ctx.creditTracker);
  ctx.creditTracker.close();
}

if (process.argv[1] && process.argv[1].endsWith("index.js")) {
  runHealthcheck().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exitCode = 1;
  });
}
