# Adding a New Venue

A **venue** is an exchange, broker, or marketplace where strategies can run. Adding one is usually a one-line change to `strategies/venues.json` — perfect for a first contribution.

## When to Add a Venue

Add a venue when:
- An existing engine (Freqtrade, Hummingbot, Nautilus) supports an exchange that isn't yet listed in `venues.json`.
- A new asset class (stocks, FX, prediction markets, etc.) is supported by an engine.

## Steps

### 1. Confirm engine support

Before adding, verify that at least one engine in `packages/engines/src/` actually supports the venue. Check the upstream engine docs:

- **Freqtrade** — [supported exchanges](https://www.freqtrade.io/en/stable/exchanges/)
- **Hummingbot** — [connectors list](https://hummingbot.org/exchanges/)
- **Nautilus** — [integrations](https://nautilustrader.io/docs/latest/integrations/)

### 2. Edit `strategies/venues.json`

Add a single object to the array. Example for Interactive Brokers (Nautilus):

```json
{
  "id": "interactive_brokers",
  "name": "Interactive Brokers",
  "assetClass": "stocks",
  "type": "broker",
  "url": "https://interactivebrokers.com",
  "engines": ["nautilus"]
}
```

### 3. Field reference

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique snake_case identifier. Used as the venue key in DB and API. |
| `name` | yes | Display name shown in the UI. |
| `assetClass` | yes | Underlying asset category. One of: `crypto`, `stocks`, `fx`, `commodities`, `prediction`. Tracks the **underlying asset**, not the instrument type — e.g. Binance lists both spot and crypto futures, but its `assetClass` is `crypto`. |
| `type` | yes | Venue mechanism. One of: `cex` (centralized exchange), `dex` (decentralized / on-chain), `broker` (traditional brokerage with regulated custody). |
| `url` | yes | Public homepage. Used for the venue link in the UI. |
| `engines` | yes | Array of engine IDs that support this venue. Must match keys in `packages/engines/src/registry.ts`. |

#### Picking `assetClass` and `type`

The wizard groups venues as **assetClass → type**:

```
CRYPTO
  Centralized: Binance, Bybit, OKX, Kraken, ...
  Decentralized: Hyperliquid, dYdX, Uniswap, ...
STOCKS
  Brokers: Interactive Brokers
PREDICTION MARKETS
  Decentralized: Polymarket
  Brokers: Kalshi, Betfair
```

If you're unsure which `assetClass` to pick: choose what the venue's users actually trade. A venue listing only crypto perps is `crypto` even though "perps" sounds like derivatives. A venue listing prediction contracts (yes/no outcomes) is `prediction` regardless of whether it runs on-chain or off-chain.

### 4. Verify

```bash
pnpm typecheck && pnpm check && pnpm test
pnpm dev
```

Open the UI, click **New Desk**, and confirm the new venue appears in the venue picker. Pick it and create a desk to verify end-to-end.

### 5. Open a PR

Use this commit format:

```
feat: add <Venue Name> venue for <engine> engine
```

Example: `feat: add Interactive Brokers venue for nautilus engine`

In the PR description include:
- Link to the upstream engine documentation confirming support.
- Asset classes covered (e.g., "US stocks, options, futures via IBKR").
- Any caveats (e.g., "requires paid IBKR subscription for market data").

## Troubleshooting

**The venue doesn't show up in the wizard.**
Check that `type` is one of the allowed values and that `engines` references a real engine ID.

**Tests fail with a venue validation error.**
Schemas in `packages/shared/` may need updating if you introduce a new `type`. Open a discussion before adding new types.

## Adding Many Venues at Once

If you're bulk-importing a connector list (e.g., all 30+ Hummingbot DEXes), please:
- Group them in a single PR.
- Sort them by `type` then `name` for readability.
- Double-check each `id` is unique.
