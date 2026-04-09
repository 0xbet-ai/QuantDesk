/**
 * `analyst.mode-classic` — execution model for the `classic` strategy_mode
 * (candle-based, polling, OHLCV).
 *
 * This block stays engine-agnostic. The framework contract lives in the
 * seeded \`strategy.py\`; the agent discovers it by reading that file.
 * Do NOT name engines, data file formats, directory layouts, or native
 * file extensions here — all of that is engine-internal.
 */

export function buildClassicModeBlock(): string {
	return `## Execution Model: Classic (candle-based, polling)

Classic mode is for strategies that react to closed candles (OHLCV bars)
on a fixed timeframe.

### Data acquisition
Follow the two-path protocol in the Tools glossary (Path A first, then
Path B on failure). Classic mode uses OHLCV data on the desk's
configured timeframe.

### Execution
Write / refine your strategy in \`strategy.py\` (preserving the seeded
imports and class structure) and call \`run_backtest\` to execute it.
React to the returned metrics on the same turn. For auxiliary scripts
(fetchers, exploration), use \`run_script\`.`;
}
