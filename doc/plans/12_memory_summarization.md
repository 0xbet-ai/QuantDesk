# 12 — Memory compaction: summarization (TODO)

## Tests first

1. Compaction generates an LLM summary, writes a `memory_summaries` row, and
   marks the source comments compacted.
2. The fixed/tentative split from the spec is preserved in the summary
   structure.
3. Compacted comments still render in the UI marked as "summarized".

## Then implement

- LLM summarization call via the existing CLI subprocess wrapper.
- `comments.compactedAt` column or equivalent flag.
