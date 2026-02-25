import Database from "better-sqlite3";

export type OutcomeSignal =
  | "task_completed"
  | "positive_feedback"
  | "tool_success"
  | "user_correction"
  | "session_abandoned";

export interface CreditTrackerConfig {
  alpha: number;
  initialScore: number;
  decayRate: number;
}

export interface CreditRecord {
  id: string;
  score: number;
  accessCount: number;
  createdAt: string;
  lastAccessed: string;
  decayRate: number;
}

const DEFAULT_CONFIG: CreditTrackerConfig = {
  alpha: 0.1,
  initialScore: 0.5,
  decayRate: 0.01,
};

const SIGNAL_REWARD: Record<OutcomeSignal, number> = {
  task_completed: 0.5,
  positive_feedback: 0.3,
  tool_success: 0.1,
  user_correction: -0.4,
  session_abandoned: -0.2,
};

export class CreditTracker {
  readonly db: Database.Database;
  private readonly config: CreditTrackerConfig;

  constructor(dbPath: string, config: Partial<CreditTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = new Database(dbPath);
    this.initDB();
  }

  close(): void {
    this.db.close();
  }

  ensureRecord(memoryId: string): CreditRecord {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO credit_records(id, score, access_count, created_at, last_accessed, decay_rate)
      VALUES(@id, @score, 0, @createdAt, @lastAccessed, @decayRate)
      ON CONFLICT(id) DO NOTHING
    `);
    stmt.run({
      id: memoryId,
      score: this.config.initialScore,
      createdAt: now,
      lastAccessed: now,
      decayRate: this.config.decayRate,
    });

    return this.getRecord(memoryId);
  }

  recordRetrieval(sessionId: string, memoryIds: string[]): void {
    if (memoryIds.length === 0) {
      return;
    }

    const unique = [...new Set(memoryIds)];
    for (const id of unique) {
      this.ensureRecord(id);
    }

    this.db
      .prepare(
        "INSERT INTO turn_records(session_id, retrieved_memory_ids, outcome, created_at) VALUES (?, ?, NULL, ?)",
      )
      .run(sessionId, JSON.stringify(unique), new Date().toISOString());
  }

  applyOutcome(sessionId: string, signal: OutcomeSignal): void {
    const turn = this.db
      .prepare(
        `SELECT id, retrieved_memory_ids
         FROM turn_records
         WHERE session_id = ? AND outcome IS NULL
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(sessionId) as { id: number; retrieved_memory_ids: string } | undefined;

    if (!turn) {
      return;
    }

    const memoryIds = JSON.parse(turn.retrieved_memory_ids) as string[];
    const n = Math.max(1, memoryIds.length);
    const reward = SIGNAL_REWARD[signal];
    const now = new Date().toISOString();

    const updateTurn = this.db.prepare("UPDATE turn_records SET outcome = ? WHERE id = ?");
    const updateRecord = this.db.prepare(
      "UPDATE credit_records SET score = ?, access_count = access_count + 1, last_accessed = ? WHERE id = ?",
    );
    const insertEvent = this.db.prepare(`
      INSERT INTO credit_events(memory_id, event_type, reward, old_score, new_score, session_id, created_at)
      VALUES(@memoryId, @eventType, @reward, @oldScore, @newScore, @sessionId, @createdAt)
    `);

    const tx = this.db.transaction(() => {
      for (const memoryId of memoryIds) {
        const current = this.ensureRecord(memoryId);
        const delta = reward / Math.sqrt(n);
        const newScore = (1 - this.config.alpha) * current.score + this.config.alpha * delta;

        updateRecord.run(newScore, now, memoryId);
        insertEvent.run({
          memoryId,
          eventType: signal,
          reward,
          oldScore: current.score,
          newScore,
          sessionId,
          createdAt: now,
        });
      }

      updateTurn.run(signal, turn.id);
    });

    tx();
  }

  getScore(memoryId: string): number {
    return this.ensureRecord(memoryId).score;
  }

  applyDecay(days: number): number {
    if (days <= 0) {
      return 0;
    }

    const rows = this.db
      .prepare("SELECT id, score, decay_rate FROM credit_records")
      .all() as Array<{ id: string; score: number; decay_rate: number }>;

    const update = this.db.prepare("UPDATE credit_records SET score = ? WHERE id = ?");
    const insertLog = this.db.prepare(
      "INSERT INTO lifecycle_log(action, target_ids, details, created_at) VALUES(?, ?, ?, ?)",
    );

    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const decayed = row.score * Math.exp(-row.decay_rate * days);
        update.run(decayed, row.id);
      }
      insertLog.run(
        "decay",
        JSON.stringify(rows.map((row) => row.id)),
        `Applied decay for ${days} day(s)`,
        new Date().toISOString(),
      );
    });
    tx();

    return rows.length;
  }

  getTopScored(limit: number): Array<{ id: string; score: number; accessCount: number }> {
    const safeLimit = Math.max(1, Math.min(1000, limit));
    const rows = this.db
      .prepare(
        "SELECT id, score, access_count FROM credit_records ORDER BY score DESC LIMIT ?",
      )
      .all(safeLimit) as Array<{ id: string; score: number; access_count: number }>;

    return rows.map((row) => ({
      id: row.id,
      score: row.score,
      accessCount: row.access_count,
    }));
  }

  private getRecord(memoryId: string): CreditRecord {
    const row = this.db
      .prepare(
        "SELECT id, score, access_count, created_at, last_accessed, decay_rate FROM credit_records WHERE id = ?",
      )
      .get(memoryId) as
      | {
          id: string;
          score: number;
          access_count: number;
          created_at: string;
          last_accessed: string;
          decay_rate: number;
        }
      | undefined;

    if (!row) {
      throw new Error(`Unable to load credit record for ${memoryId}`);
    }

    return {
      id: row.id,
      score: row.score,
      accessCount: row.access_count,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      decayRate: row.decay_rate,
    };
  }

  private initDB(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credit_records (
        id TEXT PRIMARY KEY,
        score REAL NOT NULL DEFAULT 0.5,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_accessed TEXT NOT NULL,
        decay_rate REAL NOT NULL DEFAULT 0.01
      );

      CREATE INDEX IF NOT EXISTS idx_credit_score ON credit_records(score DESC);
      CREATE INDEX IF NOT EXISTS idx_credit_last_accessed ON credit_records(last_accessed);

      CREATE TABLE IF NOT EXISTS credit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        reward REAL NOT NULL,
        old_score REAL NOT NULL,
        new_score REAL NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES credit_records(id)
      );

      CREATE INDEX IF NOT EXISTS idx_events_memory ON credit_events(memory_id);
      CREATE INDEX IF NOT EXISTS idx_events_session ON credit_events(session_id);

      CREATE TABLE IF NOT EXISTS turn_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        retrieved_memory_ids TEXT NOT NULL,
        outcome TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_turns_session ON turn_records(session_id);

      CREATE TABLE IF NOT EXISTS contradictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_a_id TEXT NOT NULL,
        memory_b_id TEXT NOT NULL,
        description TEXT,
        resolution TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lifecycle_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target_ids TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }
}
