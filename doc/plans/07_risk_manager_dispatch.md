# 07 — `PROPOSE_VALIDATION` → Risk Manager dispatch (TODO)

Spec: `doc/agent/{MARKERS,ROLES}.md`. The Risk Manager **infrastructure** is already in place (`agentSessions.agentRole`, `buildRiskManagerPrompt`, runner branches by role) but no code path ever creates a `risk_manager` session or dispatches a turn against it.

This phase wires the only path that wakes the Risk Manager.

## Tests first

1. Handler registered against the generic router from phase 04.
2. **approve branch**:
   - `getOrCreateSession(deskId, "risk_manager")` returns a session row with a distinct `sessionId` from the analyst session.
   - `triggerAgent` is called against that session, with the latest `runs` row injected into the prompt.
   - The RM turn produces a comment authored as `risk_manager`.
3. **reject branch** — posts "Validation skipped. Reply 'validate' to re-request." (rule #15).
4. **ignore branch** — covered by phase 02 + badge.
5. The dispatch is **single-source**: no other code path is allowed to wake the RM. A meta-test greps for `agentRole: "risk_manager"` and asserts only this handler creates such sessions.

## Then implement

- `getOrCreateSession(deskId, role)` helper.
- `proposeValidationApproveHandler` in `server/src/services/proposals/`.
- Wire it into the router.
- Update `prompt-builder.ts` `buildRiskManagerPrompt` to accept the run context if it doesn't already.
- Resolve the open question in `doc/plans/README.md`: does the RM session reuse the analyst's CLI subprocess or spawn its own?
