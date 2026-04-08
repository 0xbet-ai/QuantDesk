# 14 — Memory compaction: prompt injection (TODO)

## Tests first

1. The prompt builder injects the most recent desk-level summary, then the most
   recent experiment-level summary, ahead of raw comments.
2. The combined prompt respects the token budget; raw comments are dropped from
   the tail when the budget is exceeded.

## Then implement

- Update `prompt-builder.ts` ordering and add the budget guard.
