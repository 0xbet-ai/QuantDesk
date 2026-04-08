# 09 — Risk Manager: dispatch on `[PROPOSE_VALIDATION]` (TODO)

## Tests first

1. When the analyst emits `[PROPOSE_VALIDATION]`, the next dispatched turn has
   `role = "risk_manager"` with the risk-manager prompt template.
2. The risk-manager session has its own `sessionId` distinct from the analyst's.

## Then implement

- Dispatcher branch in `agent-trigger.ts` keyed off the last emitted marker.
