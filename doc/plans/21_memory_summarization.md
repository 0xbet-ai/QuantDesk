# 21 — LLM summarization into `memory_summaries` (TODO)

## Tests first

1. Compaction generates an LLM summary, writes a `memory_summaries` row, and marks the source comments compacted.
2. The fixed/tentative split from `doc/agent/MEMORY.md` is preserved in the summary structure.
3. Compacted comments still render in the UI marked as "summarized".
4. Summary generation failures do not crash the parent turn — they are logged and retried on the next compaction cycle.

## Then implement

- LLM summarization call via the existing CLI subprocess wrapper (or a lighter direct API call — pick one and pin it).
- `comments.compactedAt` column or equivalent flag.
- UI affordance for "summarized" comments.
