# nanobrain

Minimal CLI agent with credit-assignment memory, running in Docker containers.

## What This Is

A personal AI assistant that runs in your terminal. It spawns OpenCode (open-source, model-agnostic coding agent) inside a Docker container, connected to a credit-assignment memory system (ClawBrain) via MCP. The agent remembers what helped it succeed and forgets what didn't.

## Architecture

```
CLI input → Host process (src/index.ts) → Docker container
                                              ├── OpenCode (agent runner)
                                              └── ClawBrain MCP server (memory)
                                                    ↕
                                              memory/ directory (mounted volume)
```

Single Node.js host process. One user, one agent, no groups. Docker for isolation.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Host orchestrator: CLI I/O, container lifecycle, session management |
| `src/container-runner.ts` | Spawns Docker containers with OpenCode + mounted volumes |
| `src/task-scheduler.ts` | Cron jobs for memory maintenance (consolidation, pruning) |
| `memory-server/src/index.ts` | MCP server entry point exposing ClawBrain tools to OpenCode |
| `memory-server/src/memory-store.ts` | CRUD for entities (semantic) and episodes (episodic) |
| `memory-server/src/credit-tracker.ts` | EMA credit scoring with outcome signals |
| `memory-server/src/retrieval.ts` | Credit-weighted memory search |
| `memory-server/src/lifecycle.ts` | Consolidation, promotion, pruning logic |
| `memory-server/src/contradiction.ts` | Detects and resolves conflicting memories |
| `memory-server/src/context-budget.ts` | Dynamic allocation of context window to memory |
| `memory-server/src/memory-generator.ts` | Generates MEMORY.md from scored memories at session start |
| `container/Dockerfile` | Container image: OpenCode + Node.js + ClawBrain MCP |
| `container/opencode.json` | OpenCode config: model, MCP servers, permissions |
| `memory/` | Persistent memory directory (git-tracked, mounted into container) |

## Design Decisions

- **OpenCode over Claude Agent SDK**: Model-agnostic (75+ providers), open source, already has all agentic tools (file edit, bash, web fetch, LSP, MCP). Default model: `anthropic/claude-sonnet-4-5-20250929`.
- **ClawBrain as MCP server**: Ported from OpenClaw plugin. The agent gets memory tools via MCP protocol. No framework lock-in.
- **Docker only**: No Apple Container support. Simpler.
- **No WhatsApp, no groups**: CLI-only. Single user, single agent, single memory store.
- **Git-tracked memory**: The `memory/` directory is a git repo. Every session creates a commit. Enables rollback and diff analysis of memory evolution.
- **Two branches for self-modification experiment**:
  - `main` (Approach A): Agent edits `memory/STRATEGY.md` to change memory behavior (prompt-level, safe)
  - `branch-b-code-selfmod` (Approach B): Agent edits `memory-server/src/lifecycle.ts` directly (code-level, git-tracked for rollback)

## Commands

```bash
npm run dev          # Start in development mode
npm run build        # Compile TypeScript
npm run start        # Start production
npm test             # Run tests
./container/build.sh # Rebuild Docker container image
```

## Container Mounts

| Host Path | Container Path | Mode | Purpose |
|-----------|---------------|------|---------|
| `memory/` | `/workspace/memory/` | rw | Persistent memory store |
| `memory-server/` | `/workspace/memory-server/` | ro* | ClawBrain MCP server code |
| `data/sessions/` | `/workspace/sessions/` | rw | OpenCode session state |

*Branch B mounts `memory-server/` as rw to allow code self-modification.

## Credit Assignment

Memories are scored using EMA: `new_score = (1 - α) * old_score + α * (reward / √n)`

Outcome signals: task_completed (+0.5), positive_feedback (+0.3), tool_success (+0.1), user_correction (-0.4), session_abandoned (-0.2). User signals via `/good` and `/bad` CLI commands.

## Dependencies

- Node.js 20+
- Docker
- OpenCode (installed inside container)
- TypeScript, better-sqlite3, @modelcontextprotocol/sdk
