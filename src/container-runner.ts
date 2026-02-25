import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

/** Env vars passed through to the container (includes generic AWS config). */
export const PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "XAI_API_KEY",
  "TOGETHER_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_PROFILE",
  "AWS_REGION",
] as const;

/** Env vars that indicate a provider API key is set. Excludes AWS_REGION and AWS_PROFILE so that generic AWS config alone does not pass validation. */
export const PROVIDER_KEY_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "XAI_API_KEY",
  "TOGETHER_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;

export interface SpawnContainerOptions {
  projectRoot: string;
  sessionId: string;
  image?: string;
  memoryServerMountMode?: "ro" | "rw";
}

export function spawnContainer(
  options: SpawnContainerOptions,
): ChildProcessWithoutNullStreams {
  const {
    projectRoot,
    sessionId,
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
  ];

  for (const key of PROVIDER_ENV_VARS) {
    const value = process.env[key];
    if (value) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push(image, "opencode");

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
