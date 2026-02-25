# Database Schema: engine.db

SQLite database stored at `memory/engine.db`. Uses WAL mode for concurrent reads.

## Tables

### credit_records

Primary table tracking credit scores for each memory entry.

```sql
CREATE TABLE IF NOT EXISTS credit_records (
  id            TEXT PRIMARY KEY,        -- matches memory file ID (e.g., "entity-people-alice-chen")
  score         REAL NOT NULL DEFAULT 0.5,
  access_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,           -- ISO 8601
  last_accessed TEXT NOT NULL,           -- ISO 8601
  decay_rate    REAL NOT NULL DEFAULT 0.01
);

CREATE INDEX idx_credit_score ON credit_records(score DESC);
CREATE INDEX idx_credit_last_accessed ON credit_records(last_accessed);
```

### credit_events

Audit log of every credit update. Append-only.

```sql
CREATE TABLE IF NOT EXISTS credit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   TEXT NOT NULL,
  event_type  TEXT NOT NULL,             -- task_completed, positive_feedback, tool_success, user_correction, session_abandoned
  reward      REAL NOT NULL,
  old_score   REAL NOT NULL,
  new_score   REAL NOT NULL,
  session_id  TEXT,
  created_at  TEXT NOT NULL,             -- ISO 8601
  FOREIGN KEY (memory_id) REFERENCES credit_records(id)
);

CREATE INDEX idx_events_memory ON credit_events(memory_id);
CREATE INDEX idx_events_session ON credit_events(session_id);
```

### turn_records

Links each agent turn to the memories that were retrieved during it. Used for credit assignment.

```sql
CREATE TABLE IF NOT EXISTS turn_records (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id           TEXT NOT NULL,
  retrieved_memory_ids TEXT NOT NULL,     -- JSON array of memory IDs
  outcome              TEXT,             -- null until outcome signal received
  created_at           TEXT NOT NULL     -- ISO 8601
);

CREATE INDEX idx_turns_session ON turn_records(session_id);
```

### contradictions

Records detected conflicts between memory entries.

```sql
CREATE TABLE IF NOT EXISTS contradictions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_a_id  TEXT NOT NULL,
  memory_b_id  TEXT NOT NULL,
  description  TEXT,                     -- what the contradiction is
  resolution   TEXT,                     -- "kept_a", "kept_b", "merged", "unresolved"
  resolved_at  TEXT,                     -- ISO 8601, null if unresolved
  created_at   TEXT NOT NULL
);
```

### lifecycle_log

Audit log of consolidation, promotion, and pruning actions.

```sql
CREATE TABLE IF NOT EXISTS lifecycle_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,             -- "consolidate", "promote", "prune", "decay"
  target_ids  TEXT NOT NULL,             -- JSON array of affected memory IDs
  details     TEXT,                      -- human-readable description of what happened
  created_at  TEXT NOT NULL              -- ISO 8601
);
```

## Initialization

```typescript
function initDB(dbPath: string): Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Run CREATE TABLE IF NOT EXISTS for all tables
  return db;
}
```

## Query Patterns

```sql
-- Top scored memories for MEMORY.md generation
SELECT id, score, last_accessed,
       score * EXP(-decay_rate * (julianday('now') - julianday(last_accessed))) as effective_score
FROM credit_records
ORDER BY effective_score DESC
LIMIT ?;

-- Memories due for pruning
SELECT id, score, created_at
FROM credit_records
WHERE score < ?                              -- prune_threshold
  AND julianday('now') - julianday(created_at) > ?  -- prune_min_age_days
  AND id NOT LIKE 'entity-people-%'          -- never prune people
ORDER BY score ASC;

-- Credit update (EMA)
UPDATE credit_records
SET score = (1 - ?) * score + ? * (? / SQRT(?)),  -- alpha, alpha, reward, n_retrieved
    access_count = access_count + 1,
    last_accessed = ?
WHERE id = ?;

-- Apply global time decay
UPDATE credit_records
SET score = score * EXP(-decay_rate * (julianday('now') - julianday(last_accessed)));
```
