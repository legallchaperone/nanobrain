import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { CreditTracker } from "../memory-server/src/credit-tracker.js";
import { memoryCompact } from "../memory-server/src/lifecycle.js";
import { generateMemoryMd } from "../memory-server/src/memory-generator.js";
import { MemoryStore } from "../memory-server/src/memory-store.js";
import { destroyContainer, spawnContainer } from "./container-runner.js";
import { TaskScheduler } from "./task-scheduler.js";

const VERSION = "0.1.0";
const IMAGE_NAME = "nanobrain-agent:latest";

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (error) =>
      resolve({ code: 1, stdout, stderr: `${stderr}\n${String(error)}` }),
    );
  });
}

async function ensureDockerReady(projectRoot: string): Promise<void> {
  const info = await runCommand("docker", ["info"], projectRoot);
  if (info.code !== 0) {
    throw new Error("Docker is not available. Start Docker and retry.");
  }
}

async function ensureImageExists(projectRoot: string): Promise<void> {
  const inspect = await runCommand("docker", ["image", "inspect", IMAGE_NAME], projectRoot);
  if (inspect.code !== 0) {
    throw new Error(`Docker image '${IMAGE_NAME}' is missing. Run ./container/build.sh first.`);
  }
}

async function ensureMemoryRepo(projectRoot: string): Promise<void> {
  const memoryDir = path.join(projectRoot, "memory");
  const gitDir = path.join(memoryDir, ".git");
  try {
    await fs.stat(gitDir);
  } catch {
    await runCommand("git", ["init"], memoryDir);
    await runCommand("git", ["add", "-A"], memoryDir);
    await runCommand("git", ["commit", "--allow-empty", "-m", "init memory"], memoryDir);
  }
}

async function commitMemoryChanges(projectRoot: string, reason: string): Promise<void> {
  const memoryDir = path.join(projectRoot, "memory");
  const status = await runCommand("git", ["status", "--porcelain"], memoryDir);
  if (status.code !== 0 || status.stdout.trim() === "") {
    return;
  }

  await runCommand("git", ["add", "-A"], memoryDir);
  const timestamp = new Date().toISOString();
  await runCommand("git", ["commit", "-m", `session: ${reason} (${timestamp})`], memoryDir);
}

async function generateSessionMemory(projectRoot: string): Promise<void> {
  const memoryDir = path.join(projectRoot, "memory");
  const memoryStore = new MemoryStore(memoryDir);
  const creditTracker = new CreditTracker(path.join(memoryDir, "engine.db"));
  try {
    await generateMemoryMd(memoryDir, memoryStore, creditTracker, 5000);
  } finally {
    creditTracker.close();
  }
}

async function handleFeedback(projectRoot: string, sessionId: string, good: boolean): Promise<void> {
  const tracker = new CreditTracker(path.join(projectRoot, "memory", "engine.db"));
  try {
    tracker.applyOutcome(sessionId, good ? "positive_feedback" : "user_correction");
  } finally {
    tracker.close();
  }
}

async function printStatus(projectRoot: string): Promise<void> {
  const tracker = new CreditTracker(path.join(projectRoot, "memory", "engine.db"));
  try {
    const stats = tracker.db
      .prepare("SELECT COUNT(*) AS total, AVG(score) AS avg_score FROM credit_records")
      .get() as { total: number; avg_score: number | null };
    console.log(`memory entries: ${stats.total}`);
    console.log(`average score: ${(stats.avg_score ?? 0).toFixed(3)}`);
  } finally {
    tracker.close();
  }
}

async function runCompact(projectRoot: string): Promise<void> {
  const memoryDir = path.join(projectRoot, "memory");
  const store = new MemoryStore(memoryDir);
  const tracker = new CreditTracker(path.join(memoryDir, "engine.db"));
  try {
    const report = await memoryCompact(store, tracker);
    console.log(
      `compact: consolidated=${report.consolidated}, promoted=${report.promoted}, pruned=${report.pruned}`,
    );
  } finally {
    tracker.close();
  }
}

async function runScheduler(projectRoot: string): Promise<void> {
  const scheduler = new TaskScheduler(projectRoot);
  await scheduler.checkAndRun({
    runConsolidation: async () => {
      const memoryDir = path.join(projectRoot, "memory");
      const store = new MemoryStore(memoryDir);
      const tracker = new CreditTracker(path.join(memoryDir, "engine.db"));
      try {
        await memoryCompact(store, tracker);
      } finally {
        tracker.close();
      }
    },
    runPruning: async () => {
      const memoryDir = path.join(projectRoot, "memory");
      const store = new MemoryStore(memoryDir);
      const tracker = new CreditTracker(path.join(memoryDir, "engine.db"));
      try {
        await memoryCompact(store, tracker);
      } finally {
        tracker.close();
      }
    },
    runDecay: async () => {
      const tracker = new CreditTracker(path.join(projectRoot, "memory", "engine.db"));
      try {
        tracker.applyDecay(1);
      } finally {
        tracker.close();
      }
    },
  });
}

function buildSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runInteractiveSession(projectRoot: string, apiKey: string): Promise<void> {
  const sessionId = buildSessionId();
  const proc = spawnContainer({
    projectRoot,
    sessionId,
    apiKey,
  });

  proc.stdout.on("data", (chunk) => process.stdout.write(chunk));
  proc.stderr.on("data", (chunk) => process.stderr.write(chunk));

  let requestedQuit = false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  console.log("Session started. Commands: /good /bad /status /compact /quit");

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (trimmed === "/good") {
      await handleFeedback(projectRoot, sessionId, true);
      console.log("Recorded positive feedback.");
      return;
    }
    if (trimmed === "/bad") {
      await handleFeedback(projectRoot, sessionId, false);
      console.log("Recorded negative feedback.");
      return;
    }
    if (trimmed === "/status") {
      await printStatus(projectRoot);
      return;
    }
    if (trimmed === "/compact") {
      await runCompact(projectRoot);
      return;
    }
    if (trimmed === "/quit") {
      requestedQuit = true;
      rl.close();
      await destroyContainer(sessionId);
      return;
    }
    proc.stdin.write(`${line}\n`);
  });

  await new Promise<void>((resolve) => {
    proc.on("exit", () => {
      rl.close();
      resolve();
    });
    rl.on("close", () => {
      if (!requestedQuit) {
        proc.stdin.end();
      }
    });
  });
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  console.log(`nanobrain v${VERSION}`);
  await ensureDockerReady(projectRoot);
  await ensureImageExists(projectRoot);
  await ensureMemoryRepo(projectRoot);

  await generateSessionMemory(projectRoot);
  await commitMemoryChanges(projectRoot, "pre-session snapshot");
  await runInteractiveSession(projectRoot, apiKey);
  await commitMemoryChanges(projectRoot, "post-session snapshot");
  await runScheduler(projectRoot);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unexpected error");
  }
  process.exitCode = 1;
});
