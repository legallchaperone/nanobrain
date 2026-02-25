# Technical Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Host Process (src/index.ts)                                    │
│                                                                 │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ CLI I/O  │→ │ Container Runner │→ │ Task Scheduler        │  │
│  │ stdin/   │  │ spawn, attach,   │  │ cron: consolidation   │  │
│  │ stdout   │  │ stream, destroy  │  │ cron: pruning         │  │
│  └──────────┘  └──────────────────┘  └───────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │ docker run
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Docker Container (nanobrain-agent:latest)                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ OpenCode                                                │    │
│  │   model: anthropic/claude-sonnet-4-5-20250929           │    │
│  │   tools: file edit, bash, web fetch, LSP                │    │
│  │   mcp: clawbrain → memory tools                         │    │
│  └───────────────────┬─────────────────────────────────────┘    │
│                      │ MCP (stdio)                              │
│  ┌───────────────────▼─────────────────────────────────────┐    │
│  │ ClawBrain MCP Server (memory-server/)                   │    │
│  │   tools: memory_store, memory_retrieve, memory_update,  │    │
│  │          memory_search, memory_delete, credit_report,   │    │
│  │          memory_compact                                  │    │
│  │   reads/writes: /workspace/memory/                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Mounted Volumes:                                               │
│    /workspace/memory/     ← host: memory/     (rw)              │
│    /workspace/sessions/   ← host: data/sessions/ (rw)           │
│    /workspace/memory-server/ ← host: memory-server/ (ro|rw)     │
└─────────────────────────────────────────────────────────────────┘
```

## Component Specifications

### 1. Host Process (`src/index.ts`)

**Responsibilities:**
- Read user input from stdin
- Manage Docker container lifecycle (spawn, attach, stream output, destroy)
- Handle special CLI commands (`/good`, `/bad`, `/status`, `/quit`, `/compact`)
- Run task scheduler for automated memory maintenance
- Git-commit memory changes after each session

**Behavior:**
```
main():
  1. Verify Docker is running
  2. Run pre-session memory generation (call memory-generator)
  3. Git-commit any pending memory changes
  4. Spawn Docker container with opencode
  5. Attach stdin/stdout for interactive session
  6. On session end (timeout or /quit):
     a. Destroy container
     b. Git-commit memory/ changes with session summary
  7. Loop back to step 2 for next session
```

**CLI Commands** (intercepted by host, not sent to agent):
| Command | Action |
|---------|--------|
| `/good` | Signal positive outcome → credit tracker increases scores for recently-retrieved memories |
| `/bad` | Signal negative outcome → credit tracker decreases scores |
| `/status` | Print memory stats: total entries, avg credit score, last consolidation time |
| `/compact` | Trigger immediate memory consolidation |
| `/quit` | End session, commit memory, exit |

### 2. Container Runner (`src/container-runner.ts`)

**Docker invocation:**
```bash
docker run -it --rm \
  --name nanobrain-session-${SESSION_ID} \
  -v $(pwd)/memory:/workspace/memory \
  -v $(pwd)/data/sessions:/workspace/sessions \
  -v $(pwd)/memory-server:/workspace/memory-server:ro \
  -e OPENCODE_CONFIG=/workspace/opencode.json \
  -e ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY} \
  nanobrain-agent:latest \
  opencode
```

Branch B variant: mount `memory-server` as `:rw` instead of `:ro`.

**Container image contents:**
- OpenCode CLI (installed via npm)
- Node.js 20 (for MCP server)
- ClawBrain MCP server dependencies (pre-installed)
- `opencode.json` configuration

**Streaming:** Host process attaches to container's stdin/stdout in raw TTY mode. User keystrokes flow to OpenCode, OpenCode's output streams back.

### 3. ClawBrain MCP Server (`memory-server/`)

**Protocol:** MCP over stdio. OpenCode spawns the server as a child process.

**OpenCode config** (`container/opencode.json`):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5-20250929",
  "provider": {
    "anthropic": {
      "apiKey": "process.env.ANTHROPIC_API_KEY"
    }
  },
  "mcp": {
    "clawbrain": {
      "command": "node",
      "args": ["/workspace/memory-server/dist/index.js"],
      "env": {
        "MEMORY_DIR": "/workspace/memory"
      }
    }
  }
}
```

**MCP Tools:**

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `memory_store` | `{type: "entity"|"episode", category: string, name: string, content: string, tags?: string[]}` | `{id, path}` | Create a new memory entry |
| `memory_retrieve` | `{id: string}` | `{content, credit_score, metadata}` | Get a specific memory by ID |
| `memory_search` | `{query: string, type?: string, limit?: number}` | `{results: [{id, name, snippet, score}]}` | Credit-weighted search across all memories |
| `memory_update` | `{id: string, content: string}` | `{id, updated: true}` | Update an existing memory's content |
| `memory_delete` | `{id: string}` | `{id, archived: true}` | Move to archive (never hard delete) |
| `credit_report` | `{top_n?: number}` | `{entries: [{id, name, score, access_count}]}` | Show highest and lowest credit memories |
| `memory_compact` | `{}` | `{consolidated: number, pruned: number}` | Run consolidation and pruning now |

### 4. Memory Directory Structure

```
memory/
├── .git/                    # Git repository for version tracking
├── MEMORY.md                # Auto-generated each session. Top-scored memories,
│                            # formatted for context injection. ≤ context_budget tokens.
├── STRATEGY.md              # Branch A: Agent-editable memory management strategy.
│                            # Instructions the lifecycle manager reads to decide
│                            # consolidation/pruning behavior.
├── entities/                # Semantic memory: durable facts
│   ├── people/
│   │   └── {name}.md        # One file per person. Contains facts, preferences.
│   ├── projects/
│   │   └── {name}.md        # Project context, goals, status.
│   └── preferences/
│       └── {name}.md        # User preferences, tool configs, coding style.
├── episodes/                # Episodic memory: interaction summaries
│   └── {YYYY-MM}/
│       └── {slug}.md        # One per significant interaction. Timestamped.
├── archive/                 # Pruned/low-score memories (never deleted, just moved)
│   ├── entities/
│   └── episodes/
└── engine.db                # SQLite database
    Tables:
    ├── credit_records       # id, memory_id, score, access_count, created, last_accessed, decay_rate
    ├── credit_events        # id, memory_id, event_type, reward, timestamp
    ├── turn_records         # id, session_id, retrieved_memory_ids (JSON), outcome
    ├── contradictions       # id, memory_a_id, memory_b_id, resolution, timestamp
    └── lifecycle_log        # id, action (consolidate|prune|promote), target_ids, timestamp
```

**Memory file format:**
```markdown
---
id: entity-people-alice-chen
type: entity
category: people
tags: [colleague, ml-team]
created: 2026-02-25T10:00:00Z
updated: 2026-02-25T14:30:00Z
pinned: false
---

# Alice Chen

- ML engineer at the lab, focuses on vision transformers
- Prefers async communication over meetings
- Expert in PyTorch distributed training
```

### 5. Credit Tracker (`memory-server/src/credit-tracker.ts`)

**Algorithm:** Exponential Moving Average (EMA)

```
On outcome signal:
  1. Get turn_record for this turn → list of retrieved_memory_ids
  2. n = len(retrieved_memory_ids)
  3. For each memory_id:
     delta = reward / sqrt(n)     # Credit sharing
     new_score = (1 - α) * old_score + α * delta
     Update credit_records SET score = new_score, last_accessed = now
  4. Insert credit_event record
```

**Configuration:**
```typescript
const CREDIT_CONFIG = {
  alpha: 0.1,                    // EMA learning rate
  initial_score: 0.5,            // Starting credit for new memories
  decay_rate: 0.01,              // Per-day score decay for unaccessed memories
  prune_threshold: 0.2,          // Below this → candidate for pruning
  prune_min_age_days: 14,        // Never prune memories younger than this
  consolidation_interval: '24h', // How often to run consolidation
  prune_interval: '7d',          // How often to run pruning
  max_context_budget: 5000,      // Max tokens for MEMORY.md
};
```

**Outcome signals:**
| Signal | Reward | Trigger |
|--------|--------|---------|
| `task_completed` | +0.5 | Agent signals task done (end of session with output) |
| `positive_feedback` | +0.3 | User types `/good` |
| `tool_success` | +0.1 | Agent tool call succeeds after memory retrieval |
| `user_correction` | -0.4 | User types `/bad` |
| `session_abandoned` | -0.2 | Session ends with no output (timeout or error) |

### 6. Memory Generator (`memory-server/src/memory-generator.ts`)

**Runs at session start, before OpenCode is spawned.**

```
generate_memory_md():
  1. Query all credit_records ORDER BY score DESC
  2. Apply time decay: effective_score = score * exp(-decay_rate * days_since_access)
  3. Iterate entries, accumulating estimated token count
  4. Stop when context_budget is reached
  5. Format selected memories into MEMORY.md:
     - Section headers by type (## People, ## Projects, ## Preferences, ## Recent)
     - Within each section, ordered by effective_score
     - Include one-line credit score as HTML comment: <!-- score: 0.85 -->
  6. Write to memory/MEMORY.md
```

### 7. Lifecycle Manager (`memory-server/src/lifecycle.ts`)

**Consolidation** (default: every 24 hours):
1. Find episodes from the same day with overlapping tags
2. Merge into a single summary episode
3. Sum credit scores (capped at 1.0)
4. Delete originals, create merged entry
5. Log action in `lifecycle_log`

**Promotion** (default: every 48 hours):
1. Find episodes with credit score > 0.7 that contain entity-like facts
2. Extract facts into entity files (create or append)
3. Transfer credit proportionally
4. Log action

**Pruning** (default: every 7 days):
1. Find entries with score < `prune_threshold` AND age > `prune_min_age_days`
2. Skip entries where `pinned: true`
3. Skip entity type `people` (never prune people)
4. Move to `archive/` directory
5. Delete from `credit_records`
6. Log action

**Branch A:** Before running, lifecycle manager reads `memory/STRATEGY.md` and applies any overrides to thresholds, intervals, or skip rules.

**Branch B:** The lifecycle manager source code itself (`memory-server/src/lifecycle.ts`) is mounted read-write. Agent can modify the logic directly.

### 8. Task Scheduler (`src/task-scheduler.ts`)

Lightweight cron-like scheduler running in the host process.

| Task | Schedule | Action |
|------|----------|--------|
| `consolidation` | Every 24h | Invoke `memory_compact` via direct function call (not through container) |
| `pruning` | Every 7d | Same, with pruning flag |
| `decay` | Every 24h | Apply time decay to all credit scores |
| `git_commit` | After every session | `cd memory && git add -A && git commit -m "session: {summary}"` |

The scheduler does NOT spawn containers. It calls the ClawBrain functions directly (shared code between MCP server and host process).

## Data Flow: Complete Session

```
1. User runs `nanobrain`
2. Host: load state, verify Docker
3. Host: call memory-generator → writes memory/MEMORY.md
4. Host: git commit memory/ (pre-session snapshot)
5. Host: spawn Docker container
   → OpenCode starts with opencode.json config
   → OpenCode spawns ClawBrain MCP server
   → OpenCode reads memory/MEMORY.md as context
6. User types prompt
7. Host: intercept CLI commands (/good, /bad, etc.) or forward to container stdin
8. OpenCode: process prompt, optionally call ClawBrain tools
   → memory_search("relevant query") → returns scored results
   → Agent uses memory in response
   → memory_store({...}) if agent wants to save new info
9. ClawBrain: records turn_record with retrieved_memory_ids
10. User provides feedback (/good) or continues
11. Host: intercept /good → signal credit tracker via IPC
12. Credit tracker: update scores for memories used in last turn
13. Session ends (/quit or timeout)
14. Host: destroy container
15. Host: git add -A memory/ && git commit -m "session: {auto-summary}"
16. Host: run scheduled tasks if due (consolidation, pruning, decay)
```

## Error Handling

| Failure | Recovery |
|---------|----------|
| Docker not running | Host exits with clear error message and instructions |
| Container crash | Host catches exit code, commits memory state, logs error |
| MCP server crash | OpenCode continues without memory tools, host logs warning |
| SQLite lock | memory-server uses WAL mode, single writer guaranteed |
| Git conflict | Should never happen (single user), but auto-resolve with `--theirs` |
| API key missing | Host checks `ANTHROPIC_API_KEY` at startup, exits with instructions |

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Agent escapes container | Docker isolation. No `--privileged` flag. |
| Agent modifies host filesystem | Only `memory/`, `data/sessions/`, and `memory-server/` mounted. Everything else invisible. |
| Agent exfiltrates memory | Container has no network access except for OpenCode's model API calls |
| Corrupted memory state | Git-tracked. `git log` and `git revert` available. |
| Branch B: malicious code self-mod | Git diff before next session. Human can review and rollback. |
