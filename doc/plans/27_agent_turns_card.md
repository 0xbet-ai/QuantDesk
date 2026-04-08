# 27 — `agent_turns` table + turn-scoped UI card (TODO)

Spec: CLAUDE.md rules #14 (docs are spec) and #15 (no dead-ends). Today the agent's turn lifecycle is **ephemeral**: streamed over SSE, held in `CommentThread` React state, and lost on reload or server restart. A turn that triggers a `RUN_BACKTEST` or `PROPOSE_DATA_FETCH` shows a `RunWidget` while streaming, but the widget's child state (engine docker logs, data-fetch progress) only lives in memory. When the agent CLI subprocess exits — even cleanly — the card can disappear or stop updating, and the user is left wondering "did the agent die?". This violates rule #15 in spirit: the gap between "agent is working" and "agent is done, here's the next move" is invisible.

The fix is to make `turn` a first-class persisted entity that **owns** the run, the data-fetch, and the agent stdout for that cycle. The UI then renders one `TurnCard` per turn id, restorable from the DB, that contains child blocks for everything that happened inside that turn.

`runs` is **not** renamed or merged — it stays as the backtest-execution entity. It gains a `turn_id` FK so the UI can find "the run that belongs to this turn" without joining through comments.

## Schema

New table `agent_turns`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `experiment_id` | uuid fk → experiments | |
| `desk_id` | uuid fk → desks | denormalized for fast desk-scoped queries |
| `agent_role` | text | `analyst` \| `risk_manager` |
| `trigger_kind` | text | `user_message` \| `retrigger` \| `proposal_approve` \| `observer` \| `boot_reconcile` |
| `status` | text | `running` \| `completed` \| `failed` \| `stopped` |
| `started_at` | timestamptz | |
| `ended_at` | timestamptz nullable | |
| `last_heartbeat_at` | timestamptz | updated on every SSE chunk; used to detect dead subprocess |
| `failure_reason` | text nullable | populated when `status='failed'` |
| `agent_session_id` | uuid fk → agent_sessions | which CLI session this turn ran on |

FKs added on existing tables:

- `runs.turn_id uuid references agent_turns(id)` — the backtest run a turn triggered (nullable; many turns produce no run).
- `comments.turn_id uuid references agent_turns(id)` — the agent comment(s) emitted by this turn.
- (Future) `data_fetches.turn_id` once that table exists; for now the data-fetch handler can write its progress rows keyed by `turn_id` directly.

Migration: `packages/db/drizzle/0006_agent_turns.sql` + Drizzle schema update in `packages/db/src/schema.ts`.

## Server

- `triggerAgent(experimentId, role, triggerKind)` opens a turn row at the top (`status='running'`), passes `turnId` through the run loop, marks `status='completed'|'failed'|'stopped'` in a `finally` block. Heartbeat updated on every stdout chunk.
- `runs` insertion in the `RUN_BACKTEST` dispatch path stamps `turn_id` from the surrounding turn context.
- `comments` insertion (system-comment wrapper + agent-comment writer) stamps `turn_id`.
- New SSE topic: `/api/desks/:deskId/turns/stream` — streams turn lifecycle events (`turn.started`, `turn.heartbeat`, `turn.ended`) **and** child events keyed by `turnId` (`turn.agent_chunk`, `turn.run_log_chunk`, `turn.data_fetch_progress`). Replaces the per-component ad-hoc streams.
- New REST: `GET /api/turns/:id` returns the turn row + linked run + linked data-fetch progress + agent transcript reconstructed from comments and persisted chunks. This is what the "Open" button hits.
- **Boot-time reconcile**: on server start, any `agent_turns` row with `status='running'` is checked — if its `agent_session_id` has no live subprocess, the row is marked `status='failed'` with `failure_reason='server_restart'` and a rule #15 system comment is posted on the experiment naming the next move (Retry button).
- **Heartbeat watchdog**: a periodic job marks any `running` turn with `last_heartbeat_at` older than N seconds as `failed` with `failure_reason='heartbeat_timeout'`, again posting a rule #15 comment.

## UI

- Rename `RunWidget` → `TurnCard`. Props change from `(experimentNumber, entries, streaming, ...)` to `(turnId)`. The card subscribes to the turn SSE stream and renders from the turn row.
- Card layout (top → bottom):
  1. Header — agent role, trigger kind, status badge, elapsed timer, Stop button while running.
  2. Agent transcript child block — `RunTranscriptView` fed from `turn.agent_chunk` events + persisted comment text on reload.
  3. Data-fetch child block — only present if this turn ran a data fetch. Live tail (already exists in pattern from 87463ca) plus final summary.
  4. Run child block — only present if this turn triggered a backtest. Live `docker logs -f` tail of the engine container, plus final metrics row when done.
  5. Footer — "Open" button → `/desks/:deskId/turns/:turnId`. Always present (the detail page is never empty because the agent transcript is always there).
- Card stays mounted after `status` flips to `completed`/`failed`/`stopped`. Child blocks persist their final state. No more "card vanishes when streaming ends".
- `CommentThread` renders one `TurnCard` per `agent_turns` row associated with the experiment, sorted by `started_at`. Streaming card and historical cards use the same component.
- Failed-turn card shows a red status badge, the `failure_reason`, and a Retry button. Rule #15 satisfied structurally — there is no terminal turn without a visible next move.
- Turn detail page (`/desks/:deskId/turns/:turnId`) is a full-screen view of the same `TurnCard` plus the full (un-truncated) transcript and full run/data-fetch logs.

## Tests first

1. Migration applies cleanly and round-trips a turn row through Drizzle.
2. `triggerAgent` creates an `agent_turns` row in `running`, updates `last_heartbeat_at` on each chunk, and ends in `completed` on clean exit. Failure path ends in `failed` with `failure_reason` set. `Stop` ends in `stopped`.
3. `RUN_BACKTEST` dispatch stamps `runs.turn_id` correctly. `comments.turn_id` is stamped on every system + agent comment created during the turn.
4. Boot-time reconcile marks orphan `running` turns as `failed` and posts a rule #15 comment with an action phrase ("Click Retry…").
5. Heartbeat watchdog marks stale turns as `failed` and posts a rule #15 comment.
6. `GET /api/turns/:id` returns the full reconstructed turn (transcript + linked run + linked data-fetch).
7. Existing rule #15 lint (`no-dead-end-lint.test.ts` + `hasNextAction`) is extended: a `failed` turn without a corresponding action-phrase system comment fails the invariant.
8. UI smoke test: `TurnCard` renders from a fixture turn id, streaming chunks update child blocks, and the card stays mounted across `status` transitions.

## Then implement

In this order, each PR-sized:

1. Schema migration + Drizzle types.
2. `triggerAgent` lifecycle wiring (turn row + heartbeat) — no UI changes yet, existing widget keeps working.
3. `runs.turn_id` + `comments.turn_id` stamping.
4. Turn SSE stream + `GET /api/turns/:id`.
5. Boot reconcile + heartbeat watchdog (with rule #15 comments).
6. UI: `TurnCard` component reading from turn id; `CommentThread` switches to render one card per turn row.
7. Turn detail page route.
8. Engine `docker logs -f` tail wired into the run child block.

## Out of scope

- Renaming `runs` to `turns`. They are different entities; merging them collapses backtest semantics into agent semantics. Decided in conversation 2026-04-08.
- Rebuilding `agent_sessions`. It stays as the CLI session persistence layer; `agent_turns` references it.
- Live trading anything. Rule #5.
