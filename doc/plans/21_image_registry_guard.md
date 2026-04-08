# 21 — Image whitelist: registry constructor guard (TODO)

Spec: CLAUDE.md rule #7 — the managed-engine whitelist is closed at three: Freqtrade, Nautilus, Generic. New managed adapters will never be added.

## Tests first

1. Registering a fourth adapter at module load throws.
2. The current three (Freqtrade, Nautilus, Generic) still register cleanly.
3. The error message names CLAUDE.md rule #7 explicitly.

## Then implement

- Length / allow-list check in the engine registry constructor (`packages/engines/src/registry.ts`).
