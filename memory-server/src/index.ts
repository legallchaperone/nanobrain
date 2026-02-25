import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CreditTracker } from "./credit-tracker.js";
import { detectContradiction } from "./contradiction.js";
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

function clampLimit(value: number | undefined, defaultValue: number, max: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return defaultValue;
  }
  const rounded = Math.floor(value);
  return Math.max(1, Math.min(max, rounded));
}

function sessionId(): string {
  return process.env.SESSION_ID ?? "local-session";
}

const storeInputSchema = {
  type: z.enum(["entity", "episode"]),
  category: z.string().optional(),
  name: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
};

const retrieveInputSchema = {
  id: z.string(),
};

const searchInputSchema = {
  query: z.string(),
  type: z.enum(["entity", "episode"]).optional(),
  limit: z.number().optional(),
};

const updateInputSchema = {
  id: z.string(),
  content: z.string(),
};

const deleteInputSchema = {
  id: z.string(),
};

const reportInputSchema = {
  top_n: z.number().optional(),
};

export async function startMcpServer(memoryDir?: string): Promise<void> {
  const ctx = createMemoryServer(memoryDir);
  const server = new McpServer({ name: "clawbrain", version: "0.1.0" });

  server.registerTool(
    "memory_store",
    {
      description: "Store a memory entry as entity or episode.",
      inputSchema: storeInputSchema,
    },
    async (args) => {
      try {
        const tags = args.tags ?? [];
        const pinned = args.pinned ?? false;

        if (args.type === "entity") {
          if (!args.category) {
            return toolError("category is required when type is entity");
          }
          const result = await ctx.memoryStore.storeEntity(
            args.category,
            args.name,
            args.content,
            tags,
            pinned,
          );
          ctx.creditTracker.ensureRecord(result.id);
          return textResult(result);
        }
        if (args.type === "episode") {
          const result = await ctx.memoryStore.storeEpisode(args.name, args.content, tags, pinned);
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

  server.registerTool(
    "memory_retrieve",
    {
      description: "Retrieve a memory by ID.",
      inputSchema: retrieveInputSchema,
    },
    async (args) => {
      try {
        const entry = await ctx.memoryStore.retrieve(args.id);
        const score = ctx.creditTracker.getScore(args.id);
        ctx.creditTracker.recordRetrieval(sessionId(), [args.id]);

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

  server.registerTool(
    "memory_search",
    {
      description: "Search memories with credit-weighted ranking.",
      inputSchema: searchInputSchema,
    },
    async (args) => {
      try {
        const limit = clampLimit(args.limit, 5, 20);
        const weighted = await creditWeightedSearch(args.query, ctx.memoryStore, ctx.creditTracker, limit);
        const filtered = args.type
          ? weighted.filter((item) => item.type === args.type)
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

  server.registerTool(
    "memory_update",
    {
      description: "Update existing memory content.",
      inputSchema: updateInputSchema,
    },
    async (args) => {
      try {
        const before = await ctx.memoryStore.retrieve(args.id);
        const updated = await ctx.memoryStore.update(args.id, args.content);

        let contradiction: ReturnType<typeof detectContradiction> | undefined;
        if (updated.type === "entity") {
          const peers = (await ctx.memoryStore.search(updated.name, "entity", 50)).filter(
            (entry) => entry.category === updated.category && entry.id !== updated.id,
          );
          contradiction = detectContradiction(args.content, peers);
        }

        return textResult({
          id: args.id,
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

  server.registerTool(
    "memory_delete",
    {
      description: "Archive a memory entry.",
      inputSchema: deleteInputSchema,
    },
    async (args) => {
      try {
        const result = await ctx.memoryStore.delete(args.id);
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

  server.registerTool(
    "credit_report",
    {
      description: "Report current memory credit statistics.",
      inputSchema: reportInputSchema,
    },
    async (args) => {
      try {
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

  server.registerTool(
    "memory_compact",
    {
      description: "Run consolidation, promotion, and pruning.",
      inputSchema: {},
    },
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
