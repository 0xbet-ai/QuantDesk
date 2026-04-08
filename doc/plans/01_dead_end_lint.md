# 01 — Static lint: actionable system comments (TODO)

Spec: CLAUDE.md rule #15.

A CI lint that walks every `createComment({ author: "system", ... })` call site and asserts the literal `content` string contains at least one phrase from a known list of action verbs. Prevents merging code that creates a silent dead-end system comment.

## Tests first

1. Lint passes when a system comment includes `Reply with…`, `Click Approve`, `Approve to…`, `Retry by…`, `Resolve by…`, or any phrase from the configured list.
2. Lint fails when a system comment is purely informational with no action phrase. (`Backtest failed.` → fail; `Backtest failed. Reply with guidance to retry.` → pass.)
3. When the content is built dynamically and the static analyser cannot prove an action phrase is present, the lint fails — force the author to either inline the phrase or call a helper that wraps it.
4. Lint runs as part of `pnpm check` and fails the merge.

## Then implement

- Implement as a small ts-morph or `@typescript-eslint` custom rule under `tools/lint/` (or co-located with biome config — pick whichever is cheaper).
- Wire into `pnpm check`.
- Add a tiny `withNextAction(next: string, body: string)` helper so the author can opt in to the lint by construction.
- Audit and fix any existing call site that does not pass the lint (the rule #13 refusal in `agent-trigger.ts` already complies; this is a regression guard).
