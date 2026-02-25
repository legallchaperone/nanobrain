# MCP Tools Specification: ClawBrain

The ClawBrain MCP server exposes these tools to OpenCode. This is the exact API contract.

## Protocol

- Transport: stdio (stdin/stdout JSON-RPC)
- SDK: `@modelcontextprotocol/sdk`
- Server name: `clawbrain`
- Server version: `0.1.0`

## Tools

### memory_store

Create a new memory entry (entity or episode).

**Input:**
```json
{
  "type": "entity | episode",
  "category": "string",
  "name": "string",
  "content": "string",
  "tags": ["string"],
  "pinned": false
}
```

- `type`: `entity` for durable facts, `episode` for interaction summaries
- `category`: For entities: `people`, `projects`, `preferences`. For episodes: ignored (auto-organized by date).
- `name`: Kebab-case identifier. E.g., `alice-chen`, `nanobrain-setup`, `typescript-preferences`
- `content`: Markdown content (without frontmatter — server adds it)
- `tags`: Lowercase, hyphenated. Used for consolidation grouping and search.
- `pinned`: If true, never pruned by lifecycle manager.

**Output:**
```json
{
  "id": "entity-people-alice-chen",
  "path": "entities/people/alice-chen.md",
  "created": true
}
```

**Behavior:**
- If file already exists at that path, returns error suggesting `memory_update` instead.
- Creates credit_record with initial score 0.5.
- Writes markdown file with YAML frontmatter.

---

### memory_retrieve

Get a specific memory by ID.

**Input:**
```json
{
  "id": "entity-people-alice-chen"
}
```

**Output:**
```json
{
  "id": "entity-people-alice-chen",
  "type": "entity",
  "category": "people",
  "name": "alice-chen",
  "content": "# Alice Chen\n\n- ML engineer...",
  "tags": ["colleague", "ml-team"],
  "credit_score": 0.73,
  "access_count": 12,
  "created_at": "2026-02-25T10:00:00Z",
  "last_accessed": "2026-02-25T14:30:00Z",
  "pinned": false
}
```

**Behavior:**
- Records this retrieval in turn_records for credit assignment.
- Updates `last_accessed` on credit_record.
- Increments `access_count`.

---

### memory_search

Credit-weighted search across all memories.

**Input:**
```json
{
  "query": "string",
  "type": "entity | episode | null",
  "limit": 5
}
```

- `query`: Search string. Matched against filenames, tags, and content.
- `type`: Optional filter. If null, searches all types.
- `limit`: Max results (default 5, max 20).

**Output:**
```json
{
  "results": [
    {
      "id": "entity-people-alice-chen",
      "name": "alice-chen",
      "type": "entity",
      "snippet": "ML engineer at the lab, focuses on vision transformers...",
      "credit_score": 0.73,
      "relevance_score": 0.85,
      "combined_score": 0.80
    }
  ],
  "total_matches": 12
}
```

**Behavior:**
- Combined score = `relevance_score * 0.4 + credit_score * 0.6`
- Relevance is based on: exact match in name (1.0), tag match (0.8), content substring (0.5)
- All returned results are recorded in turn_records for credit assignment.

---

### memory_update

Update an existing memory's content.

**Input:**
```json
{
  "id": "entity-people-alice-chen",
  "content": "# Alice Chen\n\n- ML engineer, promoted to team lead\n- ..."
}
```

**Output:**
```json
{
  "id": "entity-people-alice-chen",
  "updated": true,
  "previous_updated_at": "2026-02-25T10:00:00Z"
}
```

**Behavior:**
- Preserves frontmatter fields (id, type, category, tags, created, pinned).
- Updates `updated` timestamp in frontmatter.
- Runs contradiction detection against other entities in same category.

---

### memory_delete

Archive a memory (soft delete — moves to archive/).

**Input:**
```json
{
  "id": "entity-preferences-old-style"
}
```

**Output:**
```json
{
  "id": "entity-preferences-old-style",
  "archived": true,
  "archive_path": "archive/entities/preferences/old-style.md"
}
```

**Behavior:**
- Moves file to `archive/` mirroring original directory structure.
- Removes credit_record from active table (keeps in credit_events for audit).
- Cannot archive pinned entries (returns error).

---

### credit_report

Show memory credit statistics.

**Input:**
```json
{
  "top_n": 10
}
```

**Output:**
```json
{
  "total_memories": 47,
  "avg_score": 0.52,
  "top": [
    {"id": "entity-people-alice-chen", "name": "alice-chen", "score": 0.91, "access_count": 34}
  ],
  "bottom": [
    {"id": "episode-2026-01-old-session", "name": "old-session", "score": 0.12, "access_count": 1}
  ],
  "prune_candidates": 3,
  "last_consolidation": "2026-02-24T08:00:00Z",
  "last_pruning": "2026-02-20T08:00:00Z"
}
```

---

### memory_compact

Trigger immediate consolidation and pruning.

**Input:**
```json
{}
```

**Output:**
```json
{
  "consolidated": 4,
  "promoted": 1,
  "pruned": 2,
  "details": [
    "Merged 3 episodes from 2026-02-24 into 'debugging-auth-session'",
    "Promoted fact from episode to entity 'projects/auth-module'",
    "Archived 'episode-2026-01/old-chat' (score: 0.08)",
    "Archived 'entity-preferences/deprecated-tool' (score: 0.15)"
  ]
}
```

**Behavior:**
- Reads STRATEGY.md for configuration overrides (Branch A).
- Runs consolidation, then promotion, then pruning in sequence.
- Logs all actions to lifecycle_log table.
