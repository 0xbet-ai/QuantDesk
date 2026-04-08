# 26 — External dataset bind mounts (TODO)

Spec: `doc/desk/STORAGE.md` "Workspace bootstrap" + "External dataset mounts", `doc/engine/README.md` Volumes. The wizard accepts zero or more user-provided host paths to existing datasets. The server **never copies** them — at every container spawn (backtest and paper) it bind-mounts each path read-only into `/workspace/data/external/<label>` in the engine container. Mappings are persisted on the desk row so reconcile after a server restart re-applies the same set.

This unlocks GB–TB datasets that would be impractical to copy. It is **higher priority than the paper trading group (Group C)** — without it, quants with large local datasets cannot use QuantDesk at all.

## Schema

Add to `desks` table:

```ts
externalMounts: jsonb<DeskExternalMount[]>().notNull().default([])

type DeskExternalMount = {
  label: string;        // unique within the desk; becomes /workspace/data/external/<label>
  hostPath: string;     // absolute, validated against the same deny-list as phase 25
  description?: string; // optional human label shown in the UI
}
```

No separate table — the mounts are a tiny per-desk array, queried only when spawning containers, never joined elsewhere.

## Tests first

1. `validateExternalMount(mount)` pure function:
   - reuses the deny-list from phase 25
   - requires `label` to be `[a-z0-9_-]+` (becomes a path segment)
   - requires `hostPath` to exist and be a readable directory at desk-creation time
2. `createDesk` with `externalMounts: [...]`:
   - validates every mount before insert
   - persists the array on the `desks` row
   - rejects label collisions within the same desk
3. Container spawn (`runBacktest`, `startPaper`) for any engine:
   - for each mount on the desk, adds `-v <hostPath>:/workspace/data/external/<label>:ro` to the docker run args
   - if a `hostPath` no longer exists at spawn time, fails fast with a system comment naming the missing label and path (rule #15: surfaces a clear next action)
4. Reconcile on server restart (phase 12):
   - re-applies the same mount set when re-attaching paper containers
   - if a mount target vanished while the server was down, transitions the session to `failed` with the same clear-error message
5. The `runs.dataset_id` foreign key remains nullable; runs that consume only external mounts have `dataset_id = null` and are reproducible only as long as the host paths still exist (this is acknowledged in `doc/desk/STORAGE.md`).

## Then implement

- Schema migration adding `desks.externalMounts`.
- `validateExternalMount` + label regex in `packages/shared/`.
- Wire into every `EngineAdapter` container-spawn helper. Cleanest place is a shared `buildDockerArgs(desk, …)` in `packages/engines/src/docker-args.ts` so adapters don't each re-derive the mount flags.
- Wizard UI: a "+ Add data folder" affordance that calls a server-side validator before submit and lets the user assign a label.
- Document the spawn-time guard in `doc/desk/STORAGE.md` "External dataset mounts" if the implementation diverges from the spec.

## Interaction with rule #13

Per the CLAUDE.md rule #13 exception clause, an agent on a desk that has at least one external mount may skip `[PROPOSE_DATA_FETCH]` and proceed directly to strategy authoring. The prompt builder must surface the mount labels and paths so the agent knows what's available without re-proposing.
