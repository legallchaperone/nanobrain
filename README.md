# nanobrain

Minimal CLI agent with credit-assignment memory. Runs [OpenCode](https://opencode.ai) inside Docker, connected to a credit-scoring memory system via MCP.

Memories that helped the agent succeed gain credit. Memories that didn't get pruned. Over time, the agent's context self-optimizes.

## Quick Start

```bash
git clone https://github.com/your-username/nanobrain.git
cd nanobrain
npm install
npm run container:build
export ANTHROPIC_API_KEY=sk-ant-...
npm run start
```

Once started, the host CLI supports local control commands:

- `/good` - reward memories used in the current session
- `/bad` - penalize memories used in the current session
- `/status` - show memory count and average score
- `/compact` - run consolidation, promotion, and pruning immediately
- `/quit` - end the current session

## How It Works

```
You → CLI → Docker container → OpenCode (any model) → Response
                                    ↕
                          ClawBrain MCP (memory tools)
                                    ↕
                          memory/ (git-tracked)
```

1. Before each session, top-scored memories are injected into `MEMORY.md`
2. Agent can search, store, and update memories during conversation
3. `/good` and `/bad` commands adjust credit scores for memories used in the response
4. Consolidation merges related memories, pruning archives stale ones
5. Everything in `memory/` is git-tracked for rollback

## Memory Credit Assignment

Each memory has a credit score (0 to 1) updated by exponential moving average:

```
new_score = (1 - α) * old_score + α * (reward / √n)
```

Where `n` is the number of co-retrieved memories (credit sharing) and reward comes from outcome signals like task completion (+0.5) or user correction (-0.4).

## Configuration

Edit `container/opencode.json` to change the model:
```json
{ "model": "anthropic/claude-sonnet-4-5-20250929" }
```

Rebuild the container after config changes:

```bash
npm run container:build
```

Edit `memory/STRATEGY.md` to change memory management behavior (pruning thresholds, consolidation rules).

## Branch A vs B

- **main** (Branch A): Agent edits `STRATEGY.md` to change memory behavior. Safe, prompt-level.
- **branch-b-code-selfmod**: Agent edits `memory-server/src/lifecycle.ts` directly. Powerful, git-tracked for review.

## Lineage

Fork of [NanoClaw](https://github.com/qwibitai/nanoclaw) (container isolation pattern). Memory system ported from [ClawBrain](https://github.com/legallchaperone/clawbrain) (credit-assignment memory for OpenClaw).

## License

MIT
