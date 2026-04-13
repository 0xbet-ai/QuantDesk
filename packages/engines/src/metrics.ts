/**
 * Shared metric derivation — single source of truth for computing
 * returnPct, drawdownPct, winRate, and totalTrades from a trade list.
 *
 * Every engine adapter calls this instead of computing metrics itself.
 * Guarantees consistency across Freqtrade, Nautilus, and Generic
 * backtests: same formula, same edge cases, same output.
 */

import type { NormalizedResult, TradeEntry } from "./types.js";

/**
 * Derive all 4 standard metrics from a trade list.
 *
 * - `returnPct`: total PnL / wallet × 100
 * - `drawdownPct`: max peak-to-trough on the equity curve (negative %)
 * - `winRate`: winning trades / total trades (0..1)
 * - `totalTrades`: trades.length
 */
export function deriveMetrics(trades: TradeEntry[], wallet: number): NormalizedResult {
	const totalTrades = trades.length;
	if (totalTrades === 0) {
		return { returnPct: 0, drawdownPct: 0, winRate: 0, totalTrades: 0, trades };
	}

	const wins = trades.filter((t) => t.pnl > 0).length;
	const winRate = wins / totalTrades;

	const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
	const returnPct = wallet > 0 ? (totalPnl / wallet) * 100 : 0;

	// Max drawdown: walk the equity curve trade-by-trade, track the
	// running peak, and record the deepest trough relative to that peak.
	let equity = wallet;
	let peak = wallet;
	let maxDd = 0;
	for (const t of trades) {
		equity += t.pnl;
		if (equity > peak) peak = equity;
		const dd = peak > 0 ? (peak - equity) / peak : 0;
		if (dd > maxDd) maxDd = dd;
	}
	const drawdownPct = -(maxDd * 100);

	return { returnPct, drawdownPct, winRate, totalTrades, trades };
}
