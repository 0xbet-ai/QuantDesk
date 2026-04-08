# 17 — Image whitelist: `ensureImage` guard (TODO)

Spec: rules #7 and #11. Pinned tags live in `packages/engines/src/images.ts` but
nothing rejects an off-list reference at runtime.

## Tests first

1. `ensureImage("freqtradeorg/freqtrade:latest")` throws.
2. `ensureImage("freqtradeorg/freqtrade:2026.3")` resolves.
3. The pinned map is the single source of truth — no inline string literals.

## Then implement

- Whitelist check at the top of `ensureImage()`.
