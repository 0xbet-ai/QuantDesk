# 23 — LLM summarization into `memory_summaries` (DONE — template-based, LLM upgrade deferred)

## What was implemented

`generateMemorySummary()` in `server/src/services/experiments.ts` produces
a structured knowledge brief on experiment completion. Template-based (no
LLM call), but captures the key learning signals:

- **Hypothesis** — first analyst comment (200 chars)
- **Run progression** — each completed backtest's metrics + RM verdict on one line
- **Best run** highlight
- **RM rejection reasons** — verbatim, 200-char cap each. This is the richest
  learning signal: specific overfitting tells, drawdown violations, structural
  critiques that the next experiment should avoid.
- **Paper trading outcome** — if promoted, which run
- **RM final assessment** — last RM comment (300 chars)
- **Analyst conclusion** — last analyst comment (200 chars)

Called from `completeExperiment()` → writes to `memory_summaries` with
`level: "experiment"`.

## Original spec vs implementation

| Spec item | Status |
|-----------|--------|
| LLM summarization call | **Deferred** — template-based is good enough for now. The structured brief captures the same signal an LLM would (hypothesis, rejection reasons, outcome). LLM upgrade makes sense when API access is available (currently CLI-only). |
| `comments.compactedAt` flag | **Not needed** — summaries are generated from runs + comments at experiment completion, not by compacting individual comments. Comments stay intact in the DB. |
| UI affordance for "summarized" comments | **Not needed** — same reason as above. No comments are modified. |
| Failure handling | Errors in `generateMemorySummary()` are caught in `completeExperiment()` — a null return skips the insert, experiment still closes normally. |

## Future upgrade path

When Claude API access is available (not just CLI), replace the template
assembly with a one-shot LLM call that reads the full experiment's
comments + runs and produces a denser summary. The `memory_summaries`
table schema and the prompt-builder injection don't change — just the
content quality improves.
