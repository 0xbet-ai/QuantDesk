# 22 — Memory compaction trigger + token budget (DONE)

## What was implemented

Token-budgeted memory injection in `prompt-builder.ts::buildAnalystPrompt()`:

- `MEMORY_TOKEN_BUDGET = 4000` tokens for the `## Context Summary` section
- Desk-level summaries always kept (highest-signal, most compressed)
- Experiment summaries kept newest-first until budget hit
- Older experiment summaries dropped gracefully
- Uses the existing `estimateTokens()` helper (chars / 4)

## Original spec vs implementation

| Spec item | Status |
|-----------|--------|
| Token threshold triggers compaction job | Replaced with **injection-time budget** — summaries are already written at experiment completion (phase 23); the budget is enforced at read time, not write time. Simpler, same effect. |
| Shared budgeter module | Not needed — `estimateTokens()` already exists in `prompt-builder.ts` and is reused for both comment trimming and memory trimming |
| Compaction triggered post-turn | Replaced with **experiment-completion trigger** — `completeExperiment()` calls `generateMemorySummary()` which writes the summary row. No mid-turn compaction needed. |
