import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskScheduler } from "./task-scheduler.js";

async function main(): Promise<void> {
  const version = "0.1.0";
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  const scheduler = new TaskScheduler(projectRoot);
  await scheduler.checkAndRun({
    runConsolidation: async () => {
      // Placeholder until lifecycle module exists.
    },
    runPruning: async () => {
      // Placeholder until lifecycle module exists.
    },
    runDecay: async () => {
      // Placeholder until credit-tracker module exists.
    },
  });

  console.log(`nanobrain v${version}`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unexpected error");
  }
  process.exitCode = 1;
});
