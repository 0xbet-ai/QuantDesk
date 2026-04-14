/**
 * Shared metric derivation for adapters that report closed round-trips
 * (Freqtrade, Nautilus). Computes universal stats AND flattens each
 * round-trip into two execution events on the public TradeEntry tape.
 *
 * Event-native sources (a generic-engine script logging individual
 * fills) build the event tape directly and don't go through here —
 * `rawStats` from `run_backtest` is then computed from whatever the
 * script chooses to expose.
 */

import type { TradeEntry } from "@quantdesk/shared";
import type { ClosedTrade, NormalizedResult } from "./types.js";

/**
 * Derive universal stats from a list of CLOSED round-trips and emit a
 * flat event tape (open + close per round-trip) suitable for the UI's
 * Trade Log. The closing event carries `metadata.pnl`; both events
 * carry `metadata.pair` when known.
 *
 * - `returnPct`: total PnL / wallet × 100
 * - `drawdownPct`: max peak-to-trough on the equity curve (negative %)
 * - `winRate`: winning trades / total round-trips (0..1)
 * - `totalTrades`: number of round-trips (NOT events)
 */
export function deriveMetrics(closed: ClosedTrade[], wallet: number): NormalizedResult {
	const totalTrades = closed.length;
	if (totalTrades === 0) {
		return { returnPct: 0, drawdownPct: 0, winRate: 0, totalTrades: 0, trades: [] };
	}

	const wins = closed.filter((t) => t.pnl > 0).length;
	const winRate = wins / totalTrades;

	const totalPnl = closed.reduce((sum, t) => sum + t.pnl, 0);
	const returnPct = wallet > 0 ? (totalPnl / wallet) * 100 : 0;

	let equity = wallet;
	let peak = wallet;
	let maxDd = 0;
	const events: TradeEntry[] = [];
	for (let i = 0; i < closed.length; i++) {
		const t = closed[i]!;
		const closeSide: "buy" | "sell" = t.openSide === "buy" ? "sell" : "buy";
		const tripId = `t${i}`;
		const baseMeta: Record<string, unknown> = { tripId };
		if (t.pair) baseMeta.pair = t.pair;
		events.push({
			time: t.openedAt,
			side: t.openSide,
			price: t.openPrice,
			amount: t.amount,
			metadata: { ...baseMeta, leg: "open" },
		});
		equity += t.pnl;
		if (equity > peak) peak = equity;
		const dd = peak > 0 ? (peak - equity) / peak : 0;
		if (dd > maxDd) maxDd = dd;
		events.push({
			time: t.closedAt,
			side: closeSide,
			price: t.closePrice,
			amount: t.amount,
			metadata: { ...baseMeta, leg: "close", pnl: t.pnl },
		});
	}
	const drawdownPct = -(maxDd * 100);

	return { returnPct, drawdownPct, winRate, totalTrades, trades: events };
}

/**
 * Universal stats for an event-native trade tape (generic-engine scripts
 * that emit individual fills). Only events whose `metadata.pnl` is a
 * number contribute; events without pnl are passed through to the UI
 * but do not move the stats. If no event carries pnl, all stats are 0
 * and the agent is expected to publish its own via `record_run_metrics`.
 */
export function deriveStatsFromEvents(
	trades: TradeEntry[],
	wallet: number,
): Omit<NormalizedResult, "trades"> {
	const pnlEvents = trades.filter((t) => typeof t.metadata?.pnl === "number");
	const totalTrades = pnlEvents.length;
	if (totalTrades === 0) {
		return { returnPct: 0, drawdownPct: 0, winRate: 0, totalTrades: 0 };
	}
	const wins = pnlEvents.filter((t) => (t.metadata!.pnl as number) > 0).length;
	const winRate = wins / totalTrades;
	const totalPnl = pnlEvents.reduce((sum, t) => sum + (t.metadata!.pnl as number), 0);
	const returnPct = wallet > 0 ? (totalPnl / wallet) * 100 : 0;
	let equity = wallet;
	let peak = wallet;
	let maxDd = 0;
	for (const t of pnlEvents) {
		equity += t.metadata!.pnl as number;
		if (equity > peak) peak = equity;
		const dd = peak > 0 ? (peak - equity) / peak : 0;
		if (dd > maxDd) maxDd = dd;
	}
	return { returnPct, drawdownPct: -(maxDd * 100), winRate, totalTrades };
}
