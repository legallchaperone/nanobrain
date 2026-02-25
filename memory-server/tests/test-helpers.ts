import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempMemoryDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nanobrain-memory-"));
  await fs.mkdir(path.join(root, "entities", "people"), { recursive: true });
  await fs.mkdir(path.join(root, "entities", "projects"), { recursive: true });
  await fs.mkdir(path.join(root, "entities", "preferences"), { recursive: true });
  await fs.mkdir(path.join(root, "episodes"), { recursive: true });
  await fs.mkdir(path.join(root, "archive"), { recursive: true });
  return root;
}

export async function removeDir(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}
