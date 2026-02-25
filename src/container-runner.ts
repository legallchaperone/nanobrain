import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

export interface SpawnContainerOptions {
  projectRoot: string;
  sessionId: string;
  apiKey: string;
  image?: string;
  memoryServerMountMode?: "ro" | "rw";
}

export function spawnContainer(
  options: SpawnContainerOptions,
): ChildProcessWithoutNullStreams {
  const {
    projectRoot,
    sessionId,
    apiKey,
    image = "nanobrain-agent:latest",
    memoryServerMountMode = "ro",
  } = options;

  const memoryPath = path.join(projectRoot, "memory");
  const sessionsPath = path.join(projectRoot, "data", "sessions");
  const memoryServerPath = path.join(projectRoot, "memory-server");
  const opencodeConfigPath = path.join(projectRoot, "container", "opencode.json");
  const systemPromptPath = path.join(projectRoot, "container", "SYSTEM_PROMPT.md");

  const args = [
    "run",
    "-i",
    "--rm",
    "--name",
    `nanobrain-session-${sessionId}`,
    "-v",
    `${memoryPath}:/workspace/memory`,
    "-v",
    `${sessionsPath}:/workspace/sessions`,
    "-v",
    `${memoryServerPath}:/workspace/memory-server:${memoryServerMountMode}`,
    "-v",
    `${opencodeConfigPath}:/workspace/opencode.json:ro`,
    "-v",
    `${systemPromptPath}:/workspace/SYSTEM_PROMPT.md:ro`,
    "-e",
    "OPENCODE_CONFIG=/workspace/opencode.json",
    "-e",
    `ANTHROPIC_API_KEY=${apiKey}`,
    image,
    "opencode",
  ];

  return spawn("docker", args, { stdio: "pipe" });
}

export function destroyContainer(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const name = `nanobrain-session-${sessionId}`;
    const proc = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}
