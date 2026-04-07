# User Flow

## 1. Onboarding

```
npx quantdesk onboard --yes
```

Sets up PostgreSQL (Docker if available, embedded PGlite as fallback), configures AI CLI adapter, opens web UI at `http://localhost:3000`.

For development, use `docker compose up -d postgres && pnpm dev` instead.

## 2. Create a Strategy Desk (Wizard)

Step-by-step wizard on first visit (or "+" button):

**Step 1 — Desk**: name and description for this strategy workspace.

**Step 2 — Venue**: where to trade? Multi-select chips from curated list (`strategies/venues.json`). Custom venue can be added via "+ Add". Multi-venue strategies (e.g. CEX-DEX arbitrage) select multiple.

**Step 3 — Strategy Mode**: how should strategies behave? Two cards:
- **Classic** (Recommended): candle-based polling strategies, TA indicators, minute-to-hour timeframes. Best for trend following, mean reversion, momentum.
- **Real-time** (Advanced): event-driven strategies reacting to ticks and order book deltas, sub-second timeframes. Best for market making, arbitrage, HFT.

Cards are enabled/disabled based on the selected venues — if a venue only supports one mode, the other is disabled with a tooltip. Engine names are never shown; the system maps the chosen mode to the appropriate engine internally.

**Step 4 — Strategy**: pick from curated catalog (`strategies/*.json`, filtered by selected venues **and strategy mode**) or describe in natural language. Agent will write the strategy code.

**Step 5 — Config**: budget (USD), target return % (per backtest period), stop-loss (max drawdown %).

**Step 6 — Launch**: review summary and confirm. Creates the desk + first Experiment. The chosen strategy mode (and the resolved engine) are locked for the desk's lifetime.

## 3. First Experiment

On launch, the first Experiment is auto-created. The system posts an automatic first comment (desk config + strategy description) to trigger the agent. Analyst agent proposes a baseline backtest plan (data range, pairs, params) via proposal UI. User approves via button, then:
1. Analyst agent fetches market data + runs initial backtest (baseline)
2. Baseline run appears in the experiment

## 4. Iterate

User posts comments on the experiment (async, not real-time):
- "Try a 15m timeframe instead of 5m"
- "Add RSI filter with period 21"

Each backtest creates a new **Run** within the same Experiment. Parameter tweaks, filter changes, and minor adjustments stay in the same Experiment.

## 5. New Experiments

Agent proposes splitting when direction changes significantly. User approves or declines. See `doc/product/AGENTS.md` for the interaction pattern and criteria.

## 6. Start Paper Trading

User approves a strategy for paper trading. Risk Manager validation is optional — a warning is shown if not validated, but user can proceed.
1. User clicks "Start Paper Trading" button next to a completed backtest run
2. Agent starts engine in paper mode with the same strategy and config
3. Paper run appears in the experiment with real-time status updates
4. User can stop the paper run at any time

