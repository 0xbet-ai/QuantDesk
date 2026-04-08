# 05 — `PROPOSE_NEW_EXPERIMENT` approve handler (TODO)

Spec: `doc/agent/MARKERS.md` `PROPOSE_NEW_EXPERIMENT` block, including its `branches` and `user_next_action`.

## Tests first

1. The handler is registered against the generic approve router from phase 04.
2. **approve branch** — creates a new `experiments` row, switches the desk's active experiment to it, and retriggers. `hasNextAction(desk)` is true (a fresh agent turn is queued).
3. **reject branch** — posts a system comment that satisfies rule #15: "Staying in the current experiment. …" with explicit next-step language.
4. **ignore branch** — covered by phase 02's afterEach + the desk-header pending-decision badge.
5. The agent-trigger detects `[PROPOSE_NEW_EXPERIMENT]` in the agent's response and attaches a `pendingProposal` (parser already exists in `triggers.ts`).

## Then implement

- `proposeNewExperimentApproveHandler` in `server/src/services/proposals/`.
- Wire it into the router from phase 04.
- Update the agent-trigger pipeline so the parsed proposal is actually persisted as `pendingProposal` metadata on the comment.
- UI: the existing comment renderer must already handle generic `pendingProposal` rendering — verify it does, otherwise extend it.
