# Desk Storage

Where a desk's state lives on disk and in the database, and how the moving parts relate. The motivation for each design choice is documented inline — the schema itself is the source of truth for column shapes (`packages/db/src/schema.ts`).

## On disk

### Per-desk workspace

```
workspaces/desk-{id}/
├── .git/
├── data/
│   ├── cache/          # symlinks into the shared download cache (server-managed)
│   └── external/       # bind-mount target for user-imported datasets (read-only)
└── ...                 # engine-specific layout
```

- The directory is created at desk creation and git-initialized.
- The exact file layout depends on the desk's pinned engine — see `doc/engine/README.md` for the per-engine workspace tree.
- The agent writes strategy code, configs, and download/backtest scripts here.
- The server commits the workspace at the end of each agent turn if it is dirty. The resulting commit hash is stored on the `Run` row that the turn produces, so every run is traceable to the exact code version that produced it.

### Workspace bootstrap (optional)

A desk can be created from a user-provided seed instead of an empty workspace. The wizard accepts:

- **Seed code path** (small) — an absolute path on the host pointing at a directory of strategy/config files. At desk creation the server validates the path against a deny-list (`~/.ssh`, `~/.aws`, `~/.gnupg`, `/etc`, `/root`, the user's home root itself), enforces a size cap, **copies** the contents into `workspaces/desk-{id}/`, and makes the initial git commit. After bootstrap the host path is never read again — the desk is self-contained.
- **External dataset paths** (large) — one or more absolute host paths pointing at existing dataset directories. These are **never copied**: at container start the server bind-mounts each path read-only into `workspaces/desk-{id}/data/external/<label>/`. The mappings are persisted in the database so they can be re-applied on every backtest run, every paper container spawn, and on reconcile after server restart. If a mount target is missing on container start, the run/session fails fast with a clear error.

The two affordances are deliberately split: code must be reproducible (committed in git, hashable, mutable by the agent over time), while datasets must be cheap (often GB–TB, immutable, read-only is fine).

### Run artifacts

```
workspaces/desk-{id}/runs/<runId>/
```

- Mounted into the engine container as the run's working directory.
- Logs and any per-run files are written here so they **survive container removal**. This is what makes paper-session recovery possible after `docker rm`, host reboot, or image upgrade — the in-memory registry can be rebuilt from on-disk state plus `docker ps` labels (CLAUDE.md rule #10).

### Shared data cache

```
~/.quantdesk/datacache/<exchange>/...
```

- One canonical copy per dataset, keyed by `(exchange, pairs, timeframe)`. The `dateRange` of a cache entry **grows over time** — see "Lookup and incremental fetch" below.
- Each desk's `workspaces/desk-{id}/data/cache/` directory **symlinks** into the cache rather than duplicating files. Two desks downloading the same exchange/pair/timeframe will share one set of files on disk.
- The cache is the only place server-downloaded OHLCV (or tick) data is materialised. User-imported datasets live wherever the user keeps them and are bind-mounted at container start under `data/external/` (see "Workspace bootstrap" above) — they are not copied into the cache.
- The database stores dataset metadata, not bars.

#### Lookup and incremental fetch

When the server handles a `data_fetch` MCP tool call (made by the agent after the user has agreed conversationally — see CLAUDE.md rules #12 / #13 and `doc/agent/TURN.md`), it does **not** unconditionally re-download. It first looks up the cache by `(exchange, pairs, timeframe)`:

| Cache state | Action |
|---|---|
| **Full hit** — cached `dateRange` already covers the requested range | Skip the download. Just insert/look-up the `desk_datasets` link and post the system comment. |
| **Partial hit** — same `(exchange, pairs, timeframe)` exists but the requested range extends beyond what is cached | Download only the missing interval(s) (incremental fetch), append into the cache, and **extend the existing `datasets` row's `dateRange`** to the new union. The `datasets` row id is preserved, so any existing `desk_datasets` links keep pointing at the correct (now-larger) row. |
| **Miss** — no row for `(exchange, pairs, timeframe)` | Full download → validate → insert a new `datasets` row → link the desk. |

**Different timeframes are different datasets.** A `1m` cache row and a `5m` cache row for the same pair are completely separate — the server does not resample one into the other. Resampling is an explicit non-goal: candle semantics vary subtly across engines (mark vs index, spread inclusion, etc.), and the agent always names the timeframe it actually wants in the proposal.

### Embedded PostgreSQL

```
~/.quantdesk/pgdata
```

- The database is started in-process via `embedded-postgres` (see `CLAUDE.md` Dev Setup).
- No Docker is required for the database. To point at an external PostgreSQL instead, set `DATABASE_URL` before running any script.

## In the database

### Datasets are global, desks reference them via M:N

- The `datasets` table is keyed conceptually by `(exchange, pairs, timeframe)` — there is no `desk_id` column on it. The `dateRange` is a property of the row that grows as the cache expands (see "Lookup and incremental fetch" above).
- The `desk_datasets` join table links a desk to the datasets it has been granted access to.
- A `data_fetch` MCP tool call (rule #13 — the agent asked, the user agreed in the previous turn) downloads the missing data (or none, on a full hit), inserts or extends the `datasets` row, and inserts a `desk_datasets` link for the current desk.
- Two desks can independently propose the same dataset; the cache and `datasets` row are shared, only the `desk_datasets` row is per-desk.
- **User-imported (bind-mounted) datasets** are tracked separately on the desk row itself, not in `datasets`. They have no `(exchange, pairs, timeframe)` key, no incremental-fetch semantics, and no cross-desk sharing — each desk declares its own mounts, and the agent inspects the mounted directory at runtime to discover what's there. The `runs.dataset_id` column is only meaningful for cache-backed datasets; runs that consume external mounts are reproducible only as long as the host paths still exist.

### Code and data versioning on the Run model

- `runs.commit_hash` — the git commit in the desk workspace at the moment the run was executed.
- `runs.dataset_id` — the global dataset row the run was executed against (backtest only).

Together these two columns make every run reproducible: given a `Run`, you can check out the exact code version and re-run it against the exact data.
