# 10 — Risk Manager: verdict loop-back (TODO)

## Tests first

1. A risk-manager `approve` verdict re-dispatches an analyst turn with the
   verdict embedded.
2. A `reject` verdict re-dispatches the analyst turn with the rejection reason
   and prevents `[RUN_PAPER]` until a fresh validation passes.

## Then implement

- Verdict marker(s) in `agent-markers.ts`.
- Loop-back in `agent-trigger.ts`.
