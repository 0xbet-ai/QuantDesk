# 25 — Spec-generated dispatch test matrix (TODO)

Spec: `doc/agent/MARKERS.md` `branches:` field on every marker.

Parse the function-signature blocks in `doc/agent/MARKERS.md` at build time,
extract every `(marker, branch)` tuple, and generate a `describe.each` test
matrix that asserts each branch leaves the desk with a clear next action.
This makes the spec the **executable source of truth** for dispatch
coverage: adding a branch in MARKERS.md without a corresponding test (or
vice versa) breaks CI.

## Tests first

1. The parser reads `doc/agent/MARKERS.md`, finds every fenced
   function-signature block, and extracts `marker` + `branches[]`.
2. The generated matrix has exactly one entry per `(marker, branch)`
   tuple — no duplicates, no omissions.
3. Each generated test boots a desk in the relevant precondition, fires the
   marker, simulates the branch outcome, and asserts `hasNextAction(desk)`
   from phase 24.
4. A meta-test asserts every branch listed in MARKERS.md is reachable from
   at least one code path in `server/src/services/agent-trigger.ts` (uses
   the same coverage data as phase 24).

## Then implement

- Markdown parser for the function-signature blocks (small custom parser,
  not a full markdown AST — the format is fixed).
- Codegen step in `pnpm test:gen` that writes
  `server/src/__tests__/generated/markers.matrix.test.ts`.
- Add the codegen step to `pnpm test` so it always runs before the suite.
- Document the contract for the `branches:` field in MARKERS.md so future
  marker authors know what shape to write.
