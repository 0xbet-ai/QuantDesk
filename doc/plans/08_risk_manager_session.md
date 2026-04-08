# 08 — Risk Manager: session model (mostly DONE — verification only)

Spec: `doc/agent/ROLES.md`.

## Already in code

- `agent_sessions.agentRole` column exists with values `"analyst" | "risk_manager"` — `packages/db/src/schema.ts`.
- `agent-runner.ts` branches the prompt template by `agentRole`: `buildAnalystPrompt` vs `buildRiskManagerPrompt`.
- `desks.ts` creates the initial analyst session at desk creation.

## Remaining gap

There is no `getOrCreateSession(experimentId, role)` helper today — risk_manager sessions are never *created* anywhere because nothing dispatches to that role yet. That gap is owned by phase 09, not this one.

## Tests first

1. Given an existing analyst session and a call to "get a risk_manager session for this desk", the helper returns a fresh session row with `agentRole = "risk_manager"` and a null `sessionId`.
2. A second call returns the same row (idempotent).
3. The risk_manager session's `sessionId` is independent of the analyst's.

## Then implement

- Add the `getOrCreateSession(deskId, role)` helper if missing. Schema and prompt branching are already done.
