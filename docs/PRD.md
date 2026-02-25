# Product Requirements Document: nanobrain

## Problem Statement

Existing personal AI assistant frameworks (OpenClaw, NanoClaw) either have too many dependencies and poor security (OpenClaw: 52+ modules, shared memory), or are locked to a single model provider (NanoClaw: Claude Agent SDK only). Both have primitive memory: flat files with no learning about what information was actually useful.

## Solution

A minimal CLI agent that:
1. Runs any LLM via OpenCode (model-agnostic)
2. Executes in Docker containers (OS-level isolation)
3. Manages memory with credit assignment — tracks which memories led to successful outcomes, strengthens those, and prunes the rest

## Target User

Single developer who wants a personal AI assistant in the terminal, with persistent memory that improves over time. Comfortable editing source code to customize.

## Core Requirements

### P0 — Must Have

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| P0-1 | CLI interface for conversing with agent | User types prompt, gets streamed response. Ctrl+C exits. |
| P0-2 | Agent runs inside Docker container | `docker ps` shows running container during interaction. Container is destroyed after session timeout. |
| P0-3 | OpenCode as agent runner | Agent can edit files, run bash, search web. Model configurable in `container/opencode.json`. |
| P0-4 | ClawBrain MCP server | OpenCode can call `memory_store`, `memory_retrieve`, `memory_update`, `memory_search` tools. |
| P0-5 | Credit-scored memory | Each memory entry has a credit score. Scores update based on outcome signals. `memory/engine.db` contains `credit_records` table. |
| P0-6 | Session-start MEMORY.md generation | Before each session, `MEMORY.md` is regenerated from top-scored memories within context budget. |
| P0-7 | Memory persistence across sessions | Memories in `memory/entities/` and `memory/episodes/` survive container restarts. |
| P0-8 | Git-tracked memory | `memory/` is a git repository. Each session creates a commit with changes. |

### P1 — Should Have

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| P1-1 | Scheduled memory maintenance | Consolidation (merge episodes) runs every 24h. Pruning (archive low-score entries) runs every 7d. |
| P1-2 | Contradiction detection | When storing a memory that conflicts with existing one, the system detects and prompts resolution. |
| P1-3 | User feedback commands | `/good` increases credit for memories used in last response. `/bad` decreases. |
| P1-4 | Context budget management | Total memory injected into context ≤ configurable token limit (default 5000). Higher-scored memories get priority. |
| P1-5 | Entity and episode memory types | Entities = durable facts (people, projects, preferences). Episodes = time-stamped interaction summaries. |

### P2 — Nice to Have (Branch B Experiment)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| P2-1 | Strategy file self-modification (Branch A) | Agent can edit `memory/STRATEGY.md` which controls memory behavior. Changes take effect next session. |
| P2-2 | Code self-modification (Branch B) | Agent can edit `memory-server/src/lifecycle.ts`. Changes are git-committed and take effect on next container build. Human can review and rollback. |
| P2-3 | A/B comparison tooling | Script to run same prompts against Branch A and Branch B, comparing memory state evolution. |

## Non-Requirements

- No WhatsApp/Telegram/Discord/Slack integration
- No multi-user support
- No web UI
- No group/channel abstraction
- No Apple Container support
- No agent swarms (single agent only)

## Technical Constraints

- Default model: `anthropic/claude-sonnet-4-5-20250929`
- Runtime: Node.js 20+, Docker
- Language: TypeScript
- Database: SQLite (via better-sqlite3) for credit scores and session state
- Memory files: Markdown (human-readable, git-friendly)
- MCP protocol: `@modelcontextprotocol/sdk` for ClawBrain ↔ OpenCode communication
