# 25 — Memory: prompt injection ordering + budget guard (TODO)

## Tests first

1. The prompt builder injects the most recent desk-level summary, then the most recent experiment-level summary, ahead of raw comments.
2. The combined prompt respects the token budget; raw comments are dropped from the tail when the budget is exceeded.
3. Summary injection is idempotent — building the same prompt twice produces the same string.

## Then implement

- Update `prompt-builder.ts` ordering and add the budget guard using the shared budgeter from phase 22.
