# 22 — Dead-end audit + system comment copy (TODO)

Spec: CLAUDE.md rule #15 + `doc/agent/MARKERS.md` per-marker `branches` /
`user_next_action` fields.

Audit every lifecycle branch — every marker × every outcome — against the
no-dead-end invariant. For each branch, finalise the exact system comment
copy and any UI affordance copy (button labels, header indicators).

## Tests first

1. For every `branches` entry in `doc/agent/MARKERS.md`, there exists a
   corresponding `user_next_action` line.
2. The set of branches in MARKERS.md is a superset of the branches actually
   reachable in `server/src/services/agent-trigger.ts`. Code paths with no
   spec entry fail the test.
3. Each `user_next_action` string is non-empty and references either a
   concrete UI element ("desk header", "Approve button copy") or a system
   comment with explicit action language.

## Then implement

- For each marker file path that emits a system comment, update the comment
  body to match the `user_next_action` copy in MARKERS.md.
- For each `pendingProposal` button, update the UI label copy to match.
- Add the desk-header "N pending decisions" indicator if missing.
