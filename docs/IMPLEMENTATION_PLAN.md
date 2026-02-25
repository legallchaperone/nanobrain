# Implementation Plan

Ordered phases. Complete each phase before starting the next. Each phase ends with a testable checkpoint.

## Phase 1: Project Skeleton

**Goal:** Empty project that compiles and runs.

### Tasks:
1. Initialize npm project: `npm init`, add TypeScript, configure `tsconfig.json` (target ES2022, module NodeNext, strict mode)
2. Install core dependencies: `typescript`, `better-sqlite3`, `@types/better-sqlite3`, `@modelcontextprotocol/sdk`
3. Install dev dependencies: `vitest`, `tsx`, `@types/node`
4. Create directory structure:
   ```
   src/
   memory-server/src/
   container/
   memory/entities/people/
   memory/entities/projects/
   memory/entities/preferences/
   memory/episodes/
   memory/archive/
   data/sessions/
   docs/
   tests/
   ```
5. Create placeholder `src/index.ts` that prints "nanobrain v0.1.0" and exits
6. Create `package.json` scripts: `dev`, `build`, `start`, `test`
7. Create `.gitignore` (node_modules, dist, data/sessions, *.db)
8. Initialize git repo in `memory/`: `cd memory && git init && git commit --allow-empty -m "init memory"`

### Checkpoint:
- `npm run build` succeeds
- `npm run start` prints version
- `memory/` is a git repo

---

## Phase 2: Memory Server (ClawBrain MCP)

**Goal:** Standalone MCP server with all memory tools, testable without Docker or OpenCode.

### Tasks:
1. Create `memory-server/package.json` with deps: `@modelcontextprotocol/sdk`, `better-sqlite3`, `glob`
2. Create `memory-server/tsconfig.json`
3. Implement `memory-server/src/memory-store.ts`:
   - `storeEntity(category, name, content, tags)` → writes markdown file to `entities/{category}/{name}.md` with YAML frontmatter
   - `storeEpisode(slug, content, tags)` → writes to `episodes/{YYYY-MM}/{slug}.md`
   - `retrieve(id)` → reads file, parses frontmatter, returns structured data
   - `update(id, content)` → rewrites file preserving frontmatter metadata
   - `search(query, type?, limit?)` → glob all memory files, match by filename/tags/content substring
   - `delete(id)` → move file to `archive/`, preserve directory structure
   - All IDs follow pattern: `{type}-{category}-{name}` (e.g., `entity-people-alice-chen`)
4. Implement `memory-server/src/credit-tracker.ts`:
   - SQLite schema: `credit_records`, `credit_events`, `turn_records`
   - `initDB(dbPath)` → create tables if not exist
   - `ensureRecord(memoryId)` → create with initial score 0.5 if missing
   - `recordRetrieval(sessionId, memoryIds)` → insert turn_record
   - `applyOutcome(sessionId, signal)` → look up last turn_record, compute EMA update for each memory
   - `getScore(memoryId)` → return current score
   - `applyDecay(days)` → batch update all scores with time decay
   - `getTopScored(limit)` → return highest-scored memory IDs
5. Implement `memory-server/src/retrieval.ts`:
   - `creditWeightedSearch(query, memoryStore, creditTracker, limit)`:
     1. Call `memoryStore.search(query)` to get candidates
     2. For each candidate, get credit score
     3. Sort by: `relevance_score * 0.4 + credit_score * 0.6`
     4. Return top `limit` results
6. Implement `memory-server/src/context-budget.ts`:
   - `allocateBudget(entries, maxTokens)`:
     1. Estimate tokens per entry (rough: `content.length / 4`)
     2. Iterate sorted-by-score entries, accumulating tokens
     3. Return entries that fit within budget
7. Implement `memory-server/src/contradiction.ts`:
   - `detectContradiction(newContent, existingEntities)`:
     1. For same-ID updates: compare old vs new, flag if semantically opposite
     2. Simple heuristic: if both mention same subject but contain negation words, flag
     3. Return `{hasContradiction, conflictingId, suggestion}`
8. Implement `memory-server/src/lifecycle.ts`:
   - `consolidate(memoryStore, creditTracker)`:
     1. Find episodes from same day with overlapping tags
     2. Merge content, sum credits (cap at 1.0)
     3. Delete originals, create merged
   - `promote(memoryStore, creditTracker)`:
     1. Find episodes with score > 0.7
     2. Extract entity-like facts, create/append to entity files
   - `prune(memoryStore, creditTracker)`:
     1. Find entries with score < threshold AND age > min_age
     2. Skip pinned, skip people entities
     3. Move to archive
   - `readStrategy(strategyPath)` → parse STRATEGY.md for override config
9. Implement `memory-server/src/memory-generator.ts`:
   - `generateMemoryMd(memoryDir, creditTracker, maxTokens)`:
     1. Get all credit records sorted by effective score (with decay)
     2. Read corresponding memory files
     3. Format into sections: People, Projects, Preferences, Recent Episodes
     4. Write `MEMORY.md`
10. Implement `memory-server/src/index.ts`:
    - MCP server using `@modelcontextprotocol/sdk`
    - Register tools: `memory_store`, `memory_retrieve`, `memory_search`, `memory_update`, `memory_delete`, `credit_report`, `memory_compact`
    - Each tool handler calls the appropriate module
    - Server communicates via stdio

### Checkpoint:
- `cd memory-server && npm run build` succeeds
- Unit tests pass for each module:
  - `memory-store.test.ts`: store, retrieve, search, update, delete
  - `credit-tracker.test.ts`: init, record, apply outcome, decay, top scored
  - `retrieval.test.ts`: credit-weighted search returns scored results
  - `lifecycle.test.ts`: consolidation merges episodes, pruning archives low-score
- MCP server starts and responds to tool calls via stdio (test with `echo '{"method":"tools/list"}' | node dist/index.js`)

---

## Phase 3: Docker Container

**Goal:** Container image with OpenCode + ClawBrain MCP server that can run interactively.

### Tasks:
1. Create `container/Dockerfile`:
   ```dockerfile
   FROM node:20-slim
   # Install OpenCode
   RUN npm install -g opencode-ai@latest
   # Pre-install memory server deps
   WORKDIR /workspace/memory-server
   COPY memory-server/package*.json ./
   RUN npm install --omit=dev
   # Working directory for agent
   WORKDIR /workspace
   ```
2. Create `container/opencode.json`:
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
3. Create `container/build.sh`:
   ```bash
   #!/bin/bash
   # Build memory-server first
   cd memory-server && npm run build && cd ..
   # Build Docker image
   docker build -t nanobrain-agent:latest -f container/Dockerfile .
   ```
4. Create `container/SYSTEM_PROMPT.md` — the system prompt OpenCode will use. Include:
   - "You are nanobrain, a personal AI assistant with persistent memory."
   - Instructions to use memory tools proactively
   - Instructions to store useful discoveries
   - Instructions to search memory before answering questions about the user

### Checkpoint:
- `./container/build.sh` succeeds
- `docker run -it --rm -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY -v $(pwd)/memory:/workspace/memory nanobrain-agent:latest opencode -p "What tools do you have?"` → shows clawbrain tools in response

---

## Phase 4: Host Process

**Goal:** Interactive CLI that manages container lifecycle and handles user commands.

### Tasks:
1. Implement `src/container-runner.ts`:
   - `spawnContainer(sessionId, apiKey)` → `docker run` with volumes, returns child process handle
   - `attachIO(proc)` → pipe host stdin to container stdin, container stdout to host stdout
   - `destroyContainer(sessionId)` → `docker kill` + `docker rm`
   - Handle container exit codes
2. Implement `src/index.ts`:
   - Parse CLI args (none needed for v1, but reserve for future)
   - Check prerequisites: Docker running, `ANTHROPIC_API_KEY` set, container image exists
   - Pre-session: call memory generator (run directly, not in container)
   - Pre-session: git commit memory changes
   - Spawn container, attach I/O
   - Intercept special commands (`/good`, `/bad`, `/status`, `/compact`, `/quit`):
     - Read stdin line by line
     - If starts with `/`, handle locally
     - Otherwise, forward to container stdin
   - On `/good` or `/bad`: write signal to IPC file in `data/ipc/` directory, which triggers credit update
   - On container exit: commit memory, run scheduled tasks if due, prompt for new session or exit
3. Implement `src/task-scheduler.ts`:
   - Track last run time for each task in `data/scheduler-state.json`
   - `checkAndRun()`:
     - If consolidation due: import and call lifecycle.consolidate()
     - If pruning due: import and call lifecycle.prune()
     - If decay due: import and call creditTracker.applyDecay()
   - Called after each session ends

### Checkpoint:
- `npm run start` launches interactive session
- User can type prompts and get responses from agent
- `/good` command works (check `engine.db` for credit event)
- `/quit` exits and creates git commit in `memory/`
- Agent can use `memory_store` tool (check that file appears in `memory/entities/`)

---

## Phase 5: Integration & Polish

**Goal:** Everything works end-to-end. System prompt tuned. Memory lifecycle runs.

### Tasks:
1. Tune `container/SYSTEM_PROMPT.md`:
   - Agent should search memory at the start of conversations about the user
   - Agent should store discoveries (user preferences, project context) proactively
   - Agent should use entity names consistently
2. Create `memory/STRATEGY.md` (Branch A default):
   ```markdown
   # Memory Strategy
   
   ## Consolidation Rules
   - Merge same-day episodes with >50% tag overlap
   - Preserve the most specific details when merging
   
   ## Pruning Rules
   - Never prune people entities
   - Archive episodes older than 30 days with score < 0.2
   - Prefer archiving over deletion
   
   ## Storage Rules
   - Store user preferences as entities, not episodes
   - One entity file per person, update don't duplicate
   - Episode slugs should be descriptive: "debugging-auth-module" not "session-42"
   ```
3. Write integration tests:
   - `test/integration/session.test.ts`: Spawn container, send prompt, verify response
   - `test/integration/memory-cycle.test.ts`: Store → retrieve → give feedback → verify credit change
   - `test/integration/lifecycle.test.ts`: Store low-score entries → run pruning → verify archived
4. Create README.md with:
   - What it is (one paragraph)
   - Quick start (clone, build, run)
   - How memory works (brief)
   - Configuration (model, credit params)
   - Branch A vs B explanation
5. Handle edge cases:
   - First run: no memories exist → MEMORY.md says "No memories yet. I'll learn about you as we interact."
   - Container build failure → clear error with `./container/build.sh` instruction
   - Memory directory not a git repo → auto-init

### Checkpoint:
- Full session works: start → chat → agent uses memory → /good → /quit → git log shows commit
- After multiple sessions, `MEMORY.md` content changes based on credit scores
- `engine.db` has credit_records with varying scores
- Integration tests pass

---

## Phase 6: Branch B (Code Self-Modification)

**Goal:** Separate branch where the agent can edit its own memory management code.

### Tasks:
1. Create branch: `git checkout -b branch-b-code-selfmod`
2. Modify `src/container-runner.ts`: mount `memory-server/` as `:rw` instead of `:ro`
3. Update `container/SYSTEM_PROMPT.md` to include:
   - "You can modify your own memory management code at `/workspace/memory-server/src/lifecycle.ts`"
   - "Changes take effect after the container is rebuilt. Commit your changes with a clear message."
   - "Be conservative. Test changes mentally before applying."
4. Add git tracking for `memory-server/src/`:
   - After session: `cd memory-server && git diff --stat` → show changes to user
   - Prompt user: "Agent modified memory-server code. Review changes? [y/n/revert]"
   - If approved: commit. If reverted: `git checkout -- .`
5. Write test: agent asked "change pruning threshold to 0.3" → verify `lifecycle.ts` was modified

### Checkpoint:
- On `branch-b-code-selfmod`: agent can modify lifecycle.ts
- Changes are shown to user after session
- User can approve or revert
- On `main`: agent cannot modify lifecycle.ts (mount is read-only)

---

## Testing Strategy

| Level | Tool | Coverage |
|-------|------|----------|
| Unit | vitest | memory-store, credit-tracker, retrieval, lifecycle, contradiction |
| Integration | vitest + Docker | Full session cycle, MCP tool calls, credit updates |
| Manual | Interactive session | Agent uses memory naturally, stores new info, retrieval feels relevant |

**Key test scenarios:**
1. Store 10 memories → give /good for 3 → verify those 3 have higher scores
2. Run 5 sessions → verify consolidation merged same-day episodes
3. Create memory with score 0.1 aged 30 days → run pruning → verify archived
4. Store contradicting facts → verify contradiction detection fires
5. Fill context budget → verify MEMORY.md includes only top-scored entries
