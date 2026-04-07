export interface DataConfig {
	exchange: string;
	pairs: string[];
	timeframe: string;
	startDate: string;
	endDate: string;
	workspacePath: string;
}

export interface DataRef {
	datasetId: string;
	path: string;
}

export interface BacktestConfig {
	strategyPath: string;
	dataRef: DataRef;
	workspacePath: string;
	runId: string;
	extraParams?: Record<string, unknown>;
}

export interface NormalizedResult {
	returnPct: number;
	drawdownPct: number;
	winRate: number;
	totalTrades: number;
	trades: TradeEntry[];
}

export interface TradeEntry {
	pair: string;
	side: "buy" | "sell";
	price: number;
	amount: number;
	pnl: number;
	openedAt: string;
	closedAt: string;
}

export interface BacktestResult {
	raw: string;
	normalized: NormalizedResult;
}

export interface PaperConfig {
	strategyPath: string;
	workspacePath: string;
	runId: string;
	/** Dry-run wallet size in USD, derived from desk.budget. */
	wallet: number;
	/** Pairs to trade, e.g. ["BTC/USDT"]. */
	pairs: string[];
	/** Exchange id, e.g. "binance". */
	exchange: string;
	/** Candle timeframe (classic engines). */
	timeframe?: string;
}

export interface PaperHandle {
	/** Docker container name, e.g. `quantdesk-paper-<runId>`. */
	containerName: string;
	runId: string;
	/** Engine-specific extras (e.g. REST API port for Freqtrade). */
	meta?: Record<string, unknown>;
}

export interface PaperStatus {
	running: boolean;
	unrealizedPnl: number;
	realizedPnl: number;
	openPositions: number;
	uptime: number;
}

export interface EngineAdapter {
	readonly name: string;
	ensureImage(): Promise<void>;
	downloadData(config: DataConfig): Promise<DataRef>;
	runBacktest(config: BacktestConfig): Promise<BacktestResult>;
	startPaper(config: PaperConfig): Promise<PaperHandle>;
	stopPaper(handle: PaperHandle): Promise<void>;
	getPaperStatus(handle: PaperHandle): Promise<PaperStatus>;
	parseResult(raw: string): NormalizedResult;
}
