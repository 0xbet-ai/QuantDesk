# 22 — Memory compaction trigger + token budget (TODO)

Spec: `doc/agent/MEMORY.md`. The `memory_summaries` table exists and is read by `prompt-builder.ts` but nothing writes to it.

## Tests first

1. When experiment comment tokens exceed the configured threshold, a compaction job is enqueued.
2. The token budgeter is shared between `prompt-builder.ts` and the compaction service (no duplicated counting logic).
3. Compaction is triggered post-turn, never mid-turn.

## Then implement

- Threshold check at the end of each turn write in `agent-trigger.ts`.
- Shared budgeter module under `packages/shared/`.
- No LLM call yet — phase 23 owns that.
