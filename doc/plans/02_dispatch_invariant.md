# 02 — Dispatch invariant: `hasNextAction` afterEach (TODO)

Spec: CLAUDE.md rule #15.

Property test hook that runs after every existing integration test of `agent-trigger.ts` and asserts the desk's post-dispatch state satisfies the no-dead-end invariant.

## Tests first

1. `hasNextAction(deskId)` returns true when:
   - (a) any unresolved `pendingProposal` exists on a comment in the desk, OR
   - (b) the latest system comment in the desk contains an action phrase (same set as phase 01), OR
   - (c) the agent retrigger queue has a pending entry for the desk.
2. The `afterEach` hook fails the test when none of (a)/(b)/(c) hold.
3. The hook is opt-in via a test helper, not global, so unit tests that intentionally inspect intermediate states are not affected.
4. Applied to every existing integration test in `server/src/__tests__/`. The currently green path (`PROPOSE_DATA_FETCH` happy + reject) must pass under the new hook on day one.

## Then implement

- `hasNextAction(deskId)` helper in `server/src/services/__tests__/helpers/`.
- `afterEachWithNoDeadEndInvariant()` test helper.
- Apply to all integration tests in `server/src/__tests__/`.
- Any test that fails because the underlying code path leaves a dead-end becomes a follow-up fix in the appropriate Group B / C phase.
