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

**Step 3 — Strategy**: pick from curated catalog (`strategies/*.json`, filtered by selected venues) or describe in natural language. Agent will write the strategy code.

**Step 4 — Config**: budget (USD), target return % (per backtest period), stop-loss (max drawdown %).

**Step 5 — Launch**: review summary and confirm. Creates the desk + first Experiment.

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

## 6. Go Live

User approves a strategy for live trading. Risk Manager validation is optional — a warning is shown if not validated, but user can proceed.
1. User clicks "Go Live" button next to a completed backtest run
2. Agent starts engine in live mode with the same strategy and config
3. Live run appears in the experiment with real-time status updates
4. User can stop the live run at any time

