# 18 — Image whitelist: `ensureImage` runtime guard (TODO)

Spec: CLAUDE.md rules #7 (closed managed-engine whitelist) and #11 (pinned images). Pinned tags live in `packages/engines/src/images.ts` but nothing rejects an off-list reference at runtime — adapters trust callers to pass only the pinned values.

## Tests first

1. `ensureImage("freqtradeorg/freqtrade:latest")` throws.
2. `ensureImage("freqtradeorg/freqtrade:2026.3")` resolves.
3. `ensureImage` accepts the Nautilus pinned digest and rejects any other Nautilus reference.
4. The pinned map is the single source of truth — no inline string literals elsewhere in the engines package.

## Then implement

- Whitelist check at the top of `ensureImage()` in each adapter (or, better, in a shared helper called by all three adapters).
- Lint / grep test that fails when an engine adapter file contains a string literal matching `freqtradeorg/` or `nautilus` outside `images.ts`.
