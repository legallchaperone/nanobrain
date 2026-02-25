# Memory Strategy

This file controls how nanobrain's memory lifecycle operates. The agent reads this at consolidation/pruning time. Edit this file to change memory management behavior.

## Consolidation Rules
- Merge same-day episodes with >50% tag overlap
- Preserve the most specific details when merging
- Combined credit score = sum of originals, capped at 1.0

## Promotion Rules
- Promote episode facts to entities when credit score > 0.7
- Transfer credit proportionally to new entity
- Only promote facts that are durable (not time-bound observations)

## Pruning Rules
- Never prune people entities
- Never prune pinned entries
- Never prune entries younger than 14 days
- Archive entries with credit score < 0.2 and age > 30 days
- Prefer archiving over deletion — pruned items go to archive/

## Storage Priorities
- User preferences → entity (preferences/)
- People mentioned → entity (people/)
- Project context → entity (projects/)
- Significant interactions → episode
- Routine conversations → don't store

## Context Budget
- Maximum tokens for MEMORY.md: 5000
- Allocation priority: entities (70%), recent episodes (30%)
- Within each category, order by effective credit score (with time decay)

## Notes
- This file is read by the lifecycle manager before each consolidation/pruning cycle
- Changes here take effect on the next cycle
- The agent can edit this file to adjust its own memory management behavior
