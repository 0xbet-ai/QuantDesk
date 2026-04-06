# Engine Adapter

Pluggable interface for backtesting and live trading engines: Freqtrade, Hummingbot, Nautilus Trader, Generic.

## Interface

```typescript
interface DataConfig {
  exchange: string;         // e.g. "binance"
  pairs: string[];          // e.g. ["BTC/USDT"]
  timeframe: string;        // e.g. "5m"
  startDate: string;        // ISO date
  endDate: string;          // ISO date
  workspacePath: string;    // e.g. "workspaces/desk-{id}"
}

interface DataRef {
  datasetId: string;
  path: string;             // filesystem path to downloaded data
}

interface BacktestConfig {
  strategyPath: string;     // path to strategy file in workspace
  dataRef: DataRef;
  workspacePath: string;
  extraParams?: Record<string, unknown>;  // engine-specific overrides
}

interface BacktestResult {
  raw: string;              // engine's raw output (JSON string)
  normalized: NormalizedResult;
}

interface NormalizedResult {
  returnPct: number;        // total return %
  drawdownPct: number;      // max drawdown %
  winRate: number;          // win rate 0-1
  totalTrades: number;
  trades: TradeEntry[];     // individual trades for run_logs
}

interface TradeEntry {
  pair: string;
  side: "buy" | "sell";
  price: number;
  amount: number;
  pnl: number;
  openedAt: string;         // ISO timestamp
  closedAt: string;
}

interface LiveConfig {
  strategyPath: string;
  workspacePath: string;
  mode: "live";
  exchangeConfig: Record<string, unknown>;  // API keys, etc.
}

interface LiveHandle {
  processId: string;        // OS PID or engine-specific handle
  runId: string;
}

interface LiveStatus {
  running: boolean;
  unrealizedPnl: number;
  realizedPnl: number;
  openPositions: number;
  uptime: number;           // seconds
}

interface EngineAdapter {
  ensureInstalled(): Promise<void>;
  downloadData(config: DataConfig): Promise<DataRef>;
  runBacktest(config: BacktestConfig): Promise<BacktestResult>;
  startLive(config: LiveConfig): Promise<LiveHandle>;
  stopLive(handle: LiveHandle): Promise<void>;
  getLiveStatus(handle: LiveHandle): Promise<LiveStatus>;
  parseResult(raw: string): NormalizedResult;
}
```

Each engine implements this interface. Workspace structure is engine-dependent:
- Freqtrade: `strategy.py` + `config.json`
- Hummingbot: `strategy.py` or `.pyx` + `conf_*.yml`
- Nautilus: `strategy.py` + `config.py`
- Generic: agent-written scripts (any language). Fallback when no engine matches.

## Engine Resolution

Engine is resolved by the agent (not the user). The agent's system prompt includes the venue-engine mapping from `strategies/venues.json`. Based on the desk's `venues` and strategy description, the agent selects the engine when creating the desk.

Resolution order:
1. **Catalog strategy**: engine is specified in the strategy JSON.
2. **Custom strategy, known venues**: intersect engines from selected venues in `venues.json`. If one engine covers all venues, use it. If ambiguous, agent decides.
3. **Custom strategy, custom venue**: defaults to `generic`.
4. **Fallback**: `generic` when no existing engine fits (e.g. Kalshi, custom venues).

## Generic Engine

For strategies that don't fit existing engines. The agent writes both the strategy and the backtest/live scripts. Scripts must output `NormalizedResult` JSON to stdout.

```
ensureInstalled()   → checks node/python/bun available
downloadData()      → runs agent-written data download script
runBacktest()       → runs agent-written backtest script, parses stdout JSON
startLive()         → spawns agent-written bot process
```
