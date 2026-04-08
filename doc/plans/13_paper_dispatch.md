# 13 — `RUN_PAPER` + `PROPOSE_GO_PAPER` dispatch (TODO)

Spec: `doc/agent/MARKERS.md` `RUN_PAPER` and `PROPOSE_GO_PAPER` blocks. Both markers are parsed today but neither is dispatched.

## Tests first

1. `[RUN_PAPER] <runId>` in agent output:
   - calls `startPaperSession(runId)` (phase 12 gates)
   - on success → invokes `engineAdapter.startPaper()` and stores the returned `containerId` on the `paperSessions` row
   - on rejection (no validation / active session) → posts a rule #12 system comment naming the next step
2. The launched container carries `quantdesk.runId`, `quantdesk.deskId`, `quantdesk.engine`, `quantdesk.kind=paper` labels — verify Freqtrade (already true) and add for any other adapter that lacks them.
3. `[PROPOSE_GO_PAPER]` parser persists `pendingProposal`. The router from phase 04 routes its approve handler to the same `startPaperSession` flow as `RUN_PAPER`.
4. Reject branch posts the rule #12 copy.

## Then implement

- Action-marker dispatcher branch in `agent-trigger.ts` for `[RUN_PAPER]`.
- `proposeGoPaperApproveHandler` registered against the phase 04 router.
- Both call into `paper-sessions.startPaperSession` + `engineAdapter.startPaper`.
