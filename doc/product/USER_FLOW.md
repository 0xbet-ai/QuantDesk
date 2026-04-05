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

**Step 2 — Strategy**: pick from curated catalog (`strategies/*.json`) or describe in natural language. Agent will write the strategy code.

**Step 3 — Config**: budget (USD), target return % (per backtest period), stop-loss (max drawdown %).

**Step 4 — Launch**: review summary and confirm. Creates the desk + first Experiment.

## 3. First Experiment

On launch, the first Experiment is auto-created. The system proposes a baseline backtest plan (data range, pairs, params). User reviews and approves, then:
1. Analytics agent fetches market data + runs initial backtest (baseline)
2. Baseline run appears in the experiment

## 4. Iterate

User posts comments on the experiment (async, not real-time):
- "Try a 15m timeframe instead of 5m"
- "Add RSI filter with period 21"

Each backtest creates a new **Run** within the same Experiment. Parameter tweaks, filter changes, and minor adjustments stay in the same Experiment.

## 5. New Experiments

Agent proposes splitting when direction changes significantly. User approves or declines. See `doc/product/AGENTS.md` for the interaction pattern and criteria.

## 6. Go Live

User approves a validated strategy for live trading:
1. User clicks "Go Live" button next to a completed backtest run
2. Agent starts engine in live mode with the same strategy and config
3. Live run appears in the experiment with real-time status updates
4. User can stop the live run at any time

## 7. Review

Col 2 shows all Experiments. Click one to see its Runs, comments, and analysis in Col 3.
