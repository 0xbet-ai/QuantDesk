# 06 — `PROPOSE_COMPLETE_EXPERIMENT` approve handler (TODO)

Spec: `doc/agent/MARKERS.md` `PROPOSE_COMPLETE_EXPERIMENT` block.

## Tests first

1. Handler registered against the generic router from phase 04.
2. **approve branch** — marks the experiment as complete, no retrigger, and posts a system comment satisfying rule #15: "Experiment closed. Start a new experiment or close the desk."
3. **reject branch** — posts "Continuing this experiment." (rule #15 compliant).
4. **ignore branch** — covered by phase 02 + the desk-header pending-decision badge.
5. The agent-trigger persists the `pendingProposal`.

## Then implement

- `proposeCompleteExperimentApproveHandler` in `server/src/services/proposals/`.
- Wire it into the router.
- Add `experiments.completedAt` column if missing.
