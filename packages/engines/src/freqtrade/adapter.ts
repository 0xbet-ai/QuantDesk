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

interface FreqtradeResult {
	profit_total: number;
	max_drawdown: number;
	win_rate: number;
	trade_count: number;
	trades: FreqtradeTrade[];
}

interface FreqtradeTrade {
	pair: string;
	open_date: string;
	close_date: string;
	open_rate: number;
	close_rate: number;
	profit_abs: number;
	amount: number;
	is_short: boolean;
}

export class FreqtradeAdapter implements EngineAdapter {
	readonly name = "freqtrade";

	async ensureInstalled(): Promise<void> {
		// Check freqtrade is available
	}

	async downloadData(config: DataConfig): Promise<DataRef> {
		return { datasetId: crypto.randomUUID(), path: `${config.workspacePath}/data` };
	}

	async runBacktest(_config: BacktestConfig): Promise<BacktestResult> {
		throw new Error("Not implemented — requires freqtrade CLI");
	}

	async startPaper(_config: PaperConfig): Promise<PaperHandle> {
		throw new Error("Not implemented — requires freqtrade CLI");
	}

	async stopPaper(_handle: PaperHandle): Promise<void> {
		throw new Error("Not implemented");
	}

	async getPaperStatus(_handle: PaperHandle): Promise<PaperStatus> {
		throw new Error("Not implemented");
	}

	parseResult(raw: string): NormalizedResult {
		let data: FreqtradeResult;
		try {
			data = JSON.parse(raw);
		} catch {
			throw new Error("Failed to parse freqtrade result: invalid JSON");
		}

		if (typeof data.profit_total !== "number" || typeof data.trade_count !== "number") {
			throw new Error("Failed to parse freqtrade result: missing required fields");
		}

		const trades: TradeEntry[] = (data.trades ?? []).map((t) => ({
			pair: t.pair,
			side: t.is_short ? ("sell" as const) : ("buy" as const),
			price: t.open_rate,
			amount: t.amount,
			pnl: t.profit_abs,
			openedAt: t.open_date,
			closedAt: t.close_date,
		}));

		return {
			returnPct: data.profit_total * 100,
			drawdownPct: -Math.abs(data.max_drawdown),
			winRate: data.win_rate,
			totalTrades: data.trade_count,
			trades,
		};
	}
}
