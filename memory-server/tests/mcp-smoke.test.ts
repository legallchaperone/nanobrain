import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

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

describe("mcp server smoke", () => {
  it("lists tools and supports store/retrieve flow", async () => {
    const memoryDir = await createTempMemoryDir();
    dirs.push(memoryDir);

    const transport = new StdioClientTransport({
      command: path.resolve(process.cwd(), "node_modules/.bin/tsx"),
      args: [path.resolve(process.cwd(), "memory-server/src/index.ts")],
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_DIR: memoryDir,
        SESSION_ID: "mcp-smoke-session",
      },
      stderr: "pipe",
    });

    const client = new Client({ name: "mcp-smoke-client", version: "0.1.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);

      expect(names).toContain("memory_store");
      expect(names).toContain("memory_retrieve");
      expect(names).toContain("memory_search");

      const storeResult = await client.callTool({
        name: "memory_store",
        arguments: {
          type: "entity",
          category: "people",
          name: "mcp-test-user",
          content: "- stores from smoke test",
          tags: ["smoke"],
        },
      });
      expect(storeResult.isError).not.toBe(true);

      const storeText = storeResult.content.find((item) => item.type === "text");
      const storedPayload = JSON.parse(storeText?.text ?? "{}") as { id?: string };
      expect(storedPayload.id).toBe("entity-people-mcp-test-user");

      const retrieveResult = await client.callTool({
        name: "memory_retrieve",
        arguments: { id: "entity-people-mcp-test-user" },
      });
      expect(retrieveResult.isError).not.toBe(true);

      const retrieveText = retrieveResult.content.find((item) => item.type === "text");
      expect(retrieveText?.text).toContain("mcp-test-user");
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
