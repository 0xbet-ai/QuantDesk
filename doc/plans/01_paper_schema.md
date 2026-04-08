# 01 — Paper sessions: schema (TODO)

Spec: `doc/agent/PAPER_LIFECYCLE.md`. Today there is no first-class paper-session
entity; the only persisted record of a paper run is the `runs` row.

## Tests first

1. `paperSessions` table exists with `id`, `deskId`, `runId`, `engine`,
   `containerId`, `status` (`pending|running|stopped|failed`), `startedAt`,
   `stoppedAt`, `lastStatusAt`.
2. FK to `runs.id` is enforced.
3. Drizzle migration round-trips on a fresh DB and on the dev DB.

## Then implement

- Add the table to `packages/db/src/schema.ts`.
- `pnpm db:generate` and commit the migration under `packages/db/drizzle/`.
