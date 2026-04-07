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
	mode: "paper";
	exchangeConfig: Record<string, unknown>;
}

export interface PaperHandle {
	processId: string;
	runId: string;
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
	ensureInstalled(): Promise<void>;
	downloadData(config: DataConfig): Promise<DataRef>;
	runBacktest(config: BacktestConfig): Promise<BacktestResult>;
	startPaper(config: PaperConfig): Promise<PaperHandle>;
	stopPaper(handle: PaperHandle): Promise<void>;
	getPaperStatus(handle: PaperHandle): Promise<PaperStatus>;
	parseResult(raw: string): NormalizedResult;
}
