# 24 — Server-side `[PROPOSE_DATA_FETCH]` bootstrap for catalog desks (TODO)

Spec: CLAUDE.md rule #13. Today, when a desk is created from a catalog strategy entry, the server fires `triggerAgent` and the agent's first turn must reason about the appropriate dataset and emit `[PROPOSE_DATA_FETCH]`. The reasoning is fake — exchange comes from the chosen venue, timeframe is in the catalog entry, days/pairs are sensible defaults. This wastes an LLM round-trip and adds latency before the user sees the Approve button.

For catalog desks, derive the proposal **deterministically server-side** and attach the `pendingProposal` directly at desk-creation time. The user sees Approve buttons immediately. Custom-strategy desks (no catalog entry) still go through the agent-driven path.

## Tests first

1. `derivePr0posal(strategy: CatalogEntry, venue: Venue): DataFetchProposal` is a pure function with full unit-test coverage of every catalog entry shape.
2. `createDesk` with a `strategyId` from the catalog:
   - does **not** call `triggerAgent` for the first turn
   - inserts a system comment with `pendingProposal` of type `PROPOSE_DATA_FETCH` and the derived payload
   - the existing approve router from phase 04 handles it normally
3. `createDesk` with a custom strategy (no `strategyId`) keeps the current LLM-driven path.
4. The derived proposal's `pairs` honour the venue's trading-mode pair-naming convention (e.g. Hyperliquid perps use `BTC/USDC:USDC`).

## Then implement

- `derivePr0posal()` pure function in `packages/shared/`.
- Branch in `createDesk` (`server/src/services/desks.ts`) keyed off `input.strategyId`.
- Document the bootstrap path in `doc/agent/MARKERS.md` `PROPOSE_DATA_FETCH` `notes:` (a `pendingProposal` may originate from either the agent or the server).
