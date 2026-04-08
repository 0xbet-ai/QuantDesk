# 04 — Generic `/comments/:id/approve` dispatcher (TODO)

Spec: `doc/agent/MARKERS.md` Proposal markers section.

Today the only proposal-approval route is `POST /api/experiments/:id/data-fetch`, hard-coded to `PROPOSE_DATA_FETCH`. The other four proposal markers (`PROPOSE_VALIDATION`, `PROPOSE_NEW_EXPERIMENT`, `PROPOSE_COMPLETE_EXPERIMENT`, `PROPOSE_GO_PAPER`) have parsers but no approval route, so the UI buttons (when rendered) go nowhere — a direct rule #15 violation.

Add one generic approval router keyed off the comment's `pendingProposal.type`, then port the existing data-fetch handler into it. Subsequent phases (05–08, 11) plug in their own type handlers behind this single router.

## Tests first

1. `POST /api/comments/:commentId/approve` rejects when the comment has no `pendingProposal`.
2. `POST /api/comments/:commentId/approve` rejects when the proposal type has no registered handler.
3. With the data-fetch handler registered, the route runs the same end-to-end flow as the legacy `/experiments/:id/data-fetch` route (cache lookup, link, system comment, retrigger).
4. `POST /api/comments/:commentId/reject` posts an actionable system comment (per rule #15) and does not run the on-approve handler.
5. The legacy `/experiments/:id/data-fetch` route is removed; the UI now calls only the generic route.

## Then implement

- New router file `server/src/routes/comments.ts` with `approve` / `reject` handlers.
- Handler registry keyed by proposal type — Group B and the paper phases each register one.
- Move the body of `executeDataFetch` from the experiments route to a `dataFetchApproveHandler`.
- Update the UI client to call the generic route.
- Delete the old route.
