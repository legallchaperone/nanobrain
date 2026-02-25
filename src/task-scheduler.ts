import fs from "node:fs/promises";
import path from "node:path";

export interface SchedulerTaskConfig {
  consolidationMs: number;
  pruningMs: number;
  decayMs: number;
}

interface SchedulerState {
  consolidationLastRun: number;
  pruningLastRun: number;
  decayLastRun: number;
}

export interface SchedulerCallbacks {
  runConsolidation: () => Promise<void>;
  runPruning: () => Promise<void>;
  runDecay: () => Promise<void>;
}

const DEFAULT_CONFIG: SchedulerTaskConfig = {
  consolidationMs: 24 * 60 * 60 * 1000,
  pruningMs: 7 * 24 * 60 * 60 * 1000,
  decayMs: 24 * 60 * 60 * 1000,
};

function freshState(): SchedulerState {
  return {
    consolidationLastRun: 0,
    pruningLastRun: 0,
    decayLastRun: 0,
  };
}

export class TaskScheduler {
  private readonly statePath: string;
  private readonly config: SchedulerTaskConfig;

  constructor(projectRoot: string, config: Partial<SchedulerTaskConfig> = {}) {
    this.statePath = path.join(projectRoot, "data", "scheduler-state.json");
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async checkAndRun(callbacks: SchedulerCallbacks): Promise<void> {
    const state = await this.loadState();
    const now = Date.now();

    if (now - state.consolidationLastRun >= this.config.consolidationMs) {
      await callbacks.runConsolidation();
      state.consolidationLastRun = now;
    }

    if (now - state.pruningLastRun >= this.config.pruningMs) {
      await callbacks.runPruning();
      state.pruningLastRun = now;
    }

    if (now - state.decayLastRun >= this.config.decayMs) {
      await callbacks.runDecay();
      state.decayLastRun = now;
    }

    await this.saveState(state);
  }

  private async loadState(): Promise<SchedulerState> {
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      return { ...freshState(), ...(JSON.parse(raw) as Partial<SchedulerState>) };
    } catch {
      return freshState();
    }
  }

  private async saveState(state: SchedulerState): Promise<void> {
    const dir = path.dirname(this.statePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), "utf8");
  }
}
