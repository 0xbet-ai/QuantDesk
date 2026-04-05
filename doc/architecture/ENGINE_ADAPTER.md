# Engine Adapter

Pluggable interface for backtesting engines: Freqtrade, Hummingbot, Nautilus Trader.

## Interface

```typescript
interface EngineAdapter {
  ensureInstalled(): Promise<void>;
  downloadData(config: DataConfig): Promise<DataRef>;
  runBacktest(config: BacktestConfig): Promise<BacktestResult>;
  parseResult(raw: string): NormalizedResult;
}
```

Each engine (Freqtrade, Hummingbot, Nautilus Trader) implements this interface.
