# 11 — Memory compaction: trigger + budget (TODO)

Spec: `doc/agent/MEMORY.md`.

## Tests first

1. When experiment comment tokens exceed the configured threshold, a compaction
   job is enqueued.
2. The token budgeter is shared between `prompt-builder.ts` and the compaction
   service (no duplicated counting logic).

## Then implement

- Threshold check at the end of each turn write in `agent-trigger.ts`.
- Shared budgeter module under `packages/shared/`.
