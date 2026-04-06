import type {
	BacktestConfig,
	BacktestResult,
	DataConfig,
	DataRef,
	EngineAdapter,
	LiveConfig,
	LiveHandle,
	LiveStatus,
	NormalizedResult,
	TradeEntry,
} from "../types.js";

interface NautilusResult {
	total_return: number;
	max_drawdown: number;
	win_rate: number;
	total_trades: number;
	trades: NautilusTrade[];
}

interface NautilusTrade {
	instrument_id: string;
	side: string;
	avg_price: number;
	quantity: number;
	realized_pnl: number;
	ts_opened: string;
	ts_closed: string;
}

export class NautilusAdapter implements EngineAdapter {
	readonly name = "nautilus";

	async ensureInstalled(): Promise<void> {}
	async downloadData(config: DataConfig): Promise<DataRef> {
		return { datasetId: crypto.randomUUID(), path: `${config.workspacePath}/data` };
	}
	async runBacktest(_config: BacktestConfig): Promise<BacktestResult> {
		throw new Error("Not implemented — requires nautilus_trader");
	}
	async startLive(_config: LiveConfig): Promise<LiveHandle> {
		throw new Error("Not implemented");
	}
	async stopLive(_handle: LiveHandle): Promise<void> {
		throw new Error("Not implemented");
	}
	async getLiveStatus(_handle: LiveHandle): Promise<LiveStatus> {
		throw new Error("Not implemented");
	}

	parseResult(raw: string): NormalizedResult {
		let data: NautilusResult;
		try {
			data = JSON.parse(raw);
		} catch {
			throw new Error("Failed to parse nautilus result: invalid JSON");
		}

		if (typeof data.total_return !== "number" || typeof data.total_trades !== "number") {
			throw new Error("Failed to parse nautilus result: missing required fields");
		}

		const trades: TradeEntry[] = (data.trades ?? []).map((t) => {
			const pair = t.instrument_id.split(".")[0] ?? t.instrument_id;
			return {
				pair,
				side: t.side === "SELL" ? ("sell" as const) : ("buy" as const),
				price: t.avg_price,
				amount: t.quantity,
				pnl: t.realized_pnl,
				openedAt: t.ts_opened,
				closedAt: t.ts_closed,
			};
		});

		return {
			returnPct: data.total_return,
			drawdownPct: -Math.abs(data.max_drawdown),
			winRate: data.win_rate,
			totalTrades: data.total_trades,
			trades,
		};
	}
}
