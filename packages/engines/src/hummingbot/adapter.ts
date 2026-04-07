import type {
	BacktestConfig,
	BacktestResult,
	DataConfig,
	DataRef,
	EngineAdapter,
	NormalizedResult,
	PaperConfig,
	PaperHandle,
	PaperStatus,
	TradeEntry,
} from "../types.js";

export class HummingbotAdapter implements EngineAdapter {
	readonly name = "hummingbot";

	async ensureInstalled(): Promise<void> {}
	async downloadData(config: DataConfig): Promise<DataRef> {
		return { datasetId: crypto.randomUUID(), path: `${config.workspacePath}/data` };
	}
	async runBacktest(_config: BacktestConfig): Promise<BacktestResult> {
		throw new Error("Not implemented — requires hummingbot CLI");
	}
	async startPaper(_config: PaperConfig): Promise<PaperHandle> {
		throw new Error("Not implemented");
	}
	async stopPaper(_handle: PaperHandle): Promise<void> {
		throw new Error("Not implemented");
	}
	async getPaperStatus(_handle: PaperHandle): Promise<PaperStatus> {
		throw new Error("Not implemented");
	}

	parseResult(raw: string): NormalizedResult {
		const lines = raw.trim().split("\n");
		if (lines.length < 2) {
			throw new Error("Failed to parse hummingbot result: no trade data");
		}

		const header = lines[0]!.split(",");
		const priceIdx = header.indexOf("price");
		const amountIdx = header.indexOf("amount");
		const pnlIdx = header.indexOf("pnl");
		const sideIdx = header.indexOf("side");
		const symbolIdx = header.indexOf("symbol");
		const openIdx = header.indexOf("timestamp_open");
		const closeIdx = header.indexOf("timestamp_close");

		if (priceIdx === -1 || pnlIdx === -1) {
			throw new Error("Failed to parse hummingbot result: missing required columns");
		}

		const trades: TradeEntry[] = [];
		let totalPnl = 0;
		let wins = 0;

		for (let i = 1; i < lines.length; i++) {
			const cols = lines[i]!.split(",");
			if (cols.length < header.length) continue;

			const pnl = Number(cols[pnlIdx]);
			totalPnl += pnl;
			if (pnl > 0) wins++;

			trades.push({
				pair: cols[symbolIdx]?.replace("-", "/") ?? "",
				side: cols[sideIdx] === "sell" ? "sell" : "buy",
				price: Number(cols[priceIdx]),
				amount: Number(cols[amountIdx]),
				pnl,
				openedAt: cols[openIdx] ?? "",
				closedAt: cols[closeIdx] ?? "",
			});
		}

		const winRate = trades.length > 0 ? wins / trades.length : 0;

		return {
			returnPct: totalPnl > 0 ? (totalPnl / 10000) * 100 : totalPnl / 100,
			drawdownPct: 0,
			winRate,
			totalTrades: trades.length,
			trades,
		};
	}
}
