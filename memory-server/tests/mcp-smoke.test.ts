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
  it("lists expected memory tools over stdio", async () => {
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
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
