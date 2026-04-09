# 26 — Server-side data_fetch bootstrap for catalog desks (TODO)

Spec: CLAUDE.md rule #13. Today, when a desk is created from a catalog strategy entry, the server fires `triggerAgent` and the agent's first turn has to ask the user about the dataset it wants to download, wait for approval, then call `mcp__quantdesk__data_fetch` on the next turn. The reasoning is near-deterministic — exchange comes from the chosen venue, timeframe is in the catalog entry, days / pairs are sensible defaults. This wastes two LLM round-trips before the user sees any actual work.

For catalog desks, derive the fetch **deterministically server-side** and call `executeDataFetch` directly at desk-creation time. By the time the agent's first turn runs, the dataset is already registered and the agent can jump straight to strategy work. Custom-strategy desks (no catalog entry) still go through the conversational approval flow.

## Tests first

1. `deriveFetchProposal(strategy: CatalogEntry, venue: Venue): DataFetchProposal` is a pure function with unit-test coverage over every catalog entry shape.
2. `createDesk` with a `strategyId` from the catalog:
   - calls `executeDataFetch` with the derived proposal before `triggerAgent`
   - the resulting `datasets` row is linked to the new desk before the first agent turn fires
   - `triggerAgent` is then called so the agent's first turn sees the dataset already registered and can start writing / refining strategy code
3. `createDesk` with a custom strategy (no `strategyId`) keeps the current agent-driven path — first turn asks the user conversationally.
4. The derived proposal's `pairs` honour the venue's trading-mode pair-naming convention (e.g. Hyperliquid perps use `BTC/USDC:USDC`).

## Then implement

- `deriveFetchProposal()` pure function in `packages/shared/`.
- Branch in `createDesk` (`server/src/services/desks.ts`) keyed off `input.strategyId`: catalog → derive + execute + trigger; custom → trigger only.
- Document the bootstrap path in `doc/agent/MCP.md` under `data_fetch` notes (the tool is normally called by the agent after user consent, but the server may also execute it directly during catalog-desk bootstrap).
