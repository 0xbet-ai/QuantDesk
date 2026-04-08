# 09 — Workspace bootstrap: seed code copy at desk creation (TODO)

Spec: `doc/desk/STORAGE.md` "Workspace bootstrap". The wizard accepts an optional `seedCodePath` (absolute host path to a directory of strategy/config files). At desk creation the server validates the path, copies the contents into the new workspace, and makes the initial git commit. After that, the host path is never read again — the desk is self-contained. If `seedCodePath` is omitted, the desk is created empty (today's behaviour).

This is **higher priority than the paper trading group (Group C)** — quants frequently start from an existing local strategy and the current "describe in natural language" loop is the largest onboarding friction.

## Tests first

1. `validateSeedPath(absPath)` pure function:
   - rejects paths under `~/.ssh`, `~/.aws`, `~/.gnupg`, `/etc`, `/root`
   - rejects the user's home root itself
   - rejects non-existent / unreadable paths
   - rejects paths whose total size exceeds the cap (suggested 50 MB)
   - accepts a normal directory under e.g. `~/projects/...`
2. `bootstrapWorkspace(deskId, seedCodePath)`:
   - copies every regular file recursively into `workspaces/desk-{id}/` (skipping `.git/`, `node_modules/`, dotfiles by default)
   - preserves relative directory structure
   - is idempotent if called twice on the same empty workspace (second call is a no-op)
3. `createDesk` with `seedCodePath`:
   - calls `validateSeedPath` then `bootstrapWorkspace`
   - makes the initial git commit with message `chore: seed from {basename}`
   - the resulting desk's `runs.commit_hash` for any later run still chains back to this seed commit
4. `createDesk` without `seedCodePath` keeps the current empty-workspace behaviour exactly.

## Then implement

- `validateSeedPath` + deny-list constants in `packages/shared/`.
- `bootstrapWorkspace` in `server/src/services/workspace.ts` next to the existing per-turn commit logic.
- `seedCodePath` field on the `createDesk` input schema (`packages/shared/src/desks.ts`).
- Wizard UI: text input with a "browse" affordance that calls a server endpoint for path validation before submit (so the user gets feedback before clicking Create).
- Document the new wizard field in `doc/desk/STORAGE.md` "Workspace bootstrap" if the implementation diverges from the spec.
