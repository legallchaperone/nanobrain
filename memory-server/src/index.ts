import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { CreditTracker } from "./credit-tracker.js";
import { detectContradiction } from "./contradiction.js";
import { memoryCompact } from "./lifecycle.js";
import { MemoryStore } from "./memory-store.js";
import { generateMemoryMd } from "./memory-generator.js";
import { creditWeightedSearch } from "./retrieval.js";
import { MemoryType } from "./types.js";

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

function textResult(payload: unknown): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function toolError(message: string): { isError: true; content: [{ type: "text"; text: string }] } {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function argsFrom(extra: unknown): Record<string, unknown> {
  if (!extra || typeof extra !== "object") {
    return {};
  }
  const maybe = extra as { request?: { params?: { arguments?: unknown } } };
  const args = maybe.request?.params?.arguments;
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

function asString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required string: ${key}`);
  }
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function asBool(value: unknown, defaultValue = false): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function clampLimit(value: unknown, defaultValue: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return defaultValue;
  }
  const rounded = Math.floor(value);
  return Math.max(1, Math.min(max, rounded));
}

function isMemoryType(value: unknown): value is MemoryType {
  return value === "entity" || value === "episode";
}

function sessionId(): string {
  return process.env.SESSION_ID ?? "local-session";
}

export async function startMcpServer(memoryDir?: string): Promise<void> {
  const ctx = createMemoryServer(memoryDir);
  const server = new McpServer({ name: "clawbrain", version: "0.1.0" });

  server.tool(
    "memory_store",
    "Store a memory entry as entity or episode.",
    async (extra) => {
      try {
        const args = argsFrom(extra);
        const type = asString(args.type, "type");
        const name = asString(args.name, "name");
        const content = asString(args.content, "content");
        const tags = asStringArray(args.tags);
        const pinned = asBool(args.pinned, false);

        if (type === "entity") {
          const category = asString(args.category, "category");
          const result = await ctx.memoryStore.storeEntity(category, name, content, tags, pinned);
          ctx.creditTracker.ensureRecord(result.id);
          return textResult(result);
        }
        if (type === "episode") {
          const result = await ctx.memoryStore.storeEpisode(name, content, tags, pinned);
          ctx.creditTracker.ensureRecord(result.id);
          return textResult(result);
        }

        return toolError("type must be 'entity' or 'episode'");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "memory_store failed";
        return toolError(message);
      }
    },
  );

  server.tool(
    "memory_retrieve",
    "Retrieve a memory by ID.",
    async (extra) => {
      try {
        const args = argsFrom(extra);
        const id = asString(args.id, "id");
        const entry = await ctx.memoryStore.retrieve(id);
        const score = ctx.creditTracker.getScore(id);
        ctx.creditTracker.recordRetrieval(sessionId(), [id]);

        return textResult({
          ...entry,
          credit_score: score,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "memory_retrieve failed";
        return toolError(message);
      }
    },
  );

  server.tool(
    "memory_search",
    "Search memories with credit-weighted ranking.",
    async (extra) => {
      try {
        const args = argsFrom(extra);
        const query = asString(args.query, "query");
        const limit = clampLimit(args.limit, 5, 20);

        const weighted = await creditWeightedSearch(query, ctx.memoryStore, ctx.creditTracker, limit);
        const typeFilter = args.type;
        const filtered =
          typeFilter && isMemoryType(typeFilter)
            ? weighted.filter((item) => item.type === typeFilter)
            : weighted;

        ctx.creditTracker.recordRetrieval(
          sessionId(),
          filtered.map((item) => item.id),
        );

        return textResult({
          results: filtered.map((item) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            snippet: item.content.slice(0, 180),
            credit_score: item.creditScore,
            relevance_score: item.relevanceScore,
            combined_score: item.combinedScore,
          })),
          total_matches: filtered.length,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "memory_search failed";
        return toolError(message);
      }
    },
  );

  server.tool(
    "memory_update",
    "Update existing memory content.",
    async (extra) => {
      try {
        const args = argsFrom(extra);
        const id = asString(args.id, "id");
        const content = asString(args.content, "content");
        const before = await ctx.memoryStore.retrieve(id);
        const updated = await ctx.memoryStore.update(id, content);

        let contradiction: ReturnType<typeof detectContradiction> | undefined;
        if (updated.type === "entity") {
          const peers = (await ctx.memoryStore.search(updated.name, "entity", 50)).filter(
            (entry) => entry.category === updated.category && entry.id !== updated.id,
          );
          contradiction = detectContradiction(content, peers);
        }

        return textResult({
          id,
          updated: true,
          previous_updated_at: before.updated,
          contradiction,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "memory_update failed";
        return toolError(message);
      }
    },
  );

  server.tool(
    "memory_delete",
    "Archive a memory entry.",
    async (extra) => {
      try {
        const args = argsFrom(extra);
        const id = asString(args.id, "id");
        const result = await ctx.memoryStore.delete(id);
        return textResult({
          id: result.id,
          archived: result.archived,
          archive_path: result.archivePath,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "memory_delete failed";
        return toolError(message);
      }
    },
  );

  server.tool(
    "credit_report",
    "Report current memory credit statistics.",
    async (extra) => {
      try {
        const args = argsFrom(extra);
        const topN = clampLimit(args.top_n, 10, 100);
        const top = ctx.creditTracker.getTopScored(topN);
        const bottom = [...ctx.creditTracker.getTopScored(10_000)]
          .sort((a, b) => a.score - b.score)
          .slice(0, topN);
        const avgRow = ctx.creditTracker.db
          .prepare("SELECT AVG(score) AS avg_score, COUNT(*) AS total FROM credit_records")
          .get() as { avg_score: number | null; total: number };

        return textResult({
          total_memories: avgRow.total ?? 0,
          avg_score: avgRow.avg_score ?? 0,
          top,
          bottom,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "credit_report failed";
        return toolError(message);
      }
    },
  );

  server.tool(
    "memory_compact",
    "Run consolidation, promotion, and pruning.",
    async () => {
      try {
        const report = await memoryCompact(ctx.memoryStore, ctx.creditTracker);
        return textResult(report);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "memory_compact failed";
        return toolError(message);
      }
    },
  );

  server.server.onclose = async () => {
    ctx.creditTracker.close();
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function runHealthcheck(memoryDir?: string): Promise<void> {
  const ctx = createMemoryServer(memoryDir);
  await generateMemoryMd(ctx.memoryDir, ctx.memoryStore, ctx.creditTracker, 5000);
  await creditWeightedSearch("memory", ctx.memoryStore, ctx.creditTracker, 1);
  await memoryCompact(ctx.memoryStore, ctx.creditTracker);
  ctx.creditTracker.close();
}

if (process.argv[1] && (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.ts"))) {
  const mode = process.env.NANOBRAIN_MODE ?? "mcp";
  const runner = mode === "healthcheck" ? runHealthcheck() : startMcpServer();
  runner.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exitCode = 1;
  });
}
