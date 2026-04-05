# Engine Adapter

Pluggable interface for backtesting and live trading engines: Freqtrade, Hummingbot, Nautilus Trader.

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
  mode: "dry-run" | "live";
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

Each engine (Freqtrade, Hummingbot, Nautilus Trader) implements this interface. Workspace structure is engine-dependent:
- Freqtrade: `strategy.py` + `config.json`
- Hummingbot: `strategy.py` or `.pyx` + `conf_*.yml`
- Nautilus: `strategy.py` + `config.py`
