import type { TradeEntry } from "@quantdesk/shared";

export interface DataConfig {
	exchange: string;
	pairs: string[];
	timeframe: string;
	startDate: string;
	endDate: string;
	workspacePath: string;
	/** Optional trading mode passed through to the engine's downloader. */
	tradingMode?: "spot" | "futures" | "margin";
	/**
	 * Optional host path to use as the download target instead of
	 * `workspacePath`. Typically set by `data-fetch.ts` to the global
	 * dataset cache root so multiple desks can share a single download.
	 * When omitted, adapters write directly under `workspacePath`.
	 */
	userDir?: string;
	/**
	 * Optional line-buffered log streamer. Adapters forward the
	 * downloader container's stdout/stderr through this callback so the
	 * caller can publish progress to the UI without having to wait for
	 * the container to exit.
	 */
	onLogLine?: (line: string, stream: "stdout" | "stderr") => void;
}

export interface DataRef {
	datasetId: string;
	path: string;
}

export interface BacktestConfig {
	/**
	 * Path to the strategy file inside the workspace. Optional because
	 * managed engines (freqtrade, nautilus) ignore it and resolve the
	 * strategy by class name via `extraParams.strategy` — they only seed
	 * one file (`strategy.py`) so the path is implicit. The generic
	 * adapter requires it (it has no framework contract).
	 */
	strategyPath?: string;
	dataRef: DataRef;
	workspacePath: string;
	runId: string;
	extraParams?: Record<string, unknown>;
	/**
	 * Extra Docker bind mounts to apply on top of the workspace mount.
	 * Format: `hostPath:containerPath[:ro]`. Phase 10 — populated by the
	 * server from the desk's `externalMounts` array. Adapters concat these
	 * onto their own `volumes` array before calling `runContainer`.
	 */
	extraVolumes?: string[];
	/**
	 * Phase 27 step 8 — optional line-buffered log streamer. When provided,
	 * the adapter forwards the engine container's stdout/stderr line-by-line
	 * so the UI can live-tail the backtest run inside the TurnCard. Callers
	 * that omit this keep the prior blocking-run behavior.
	 */
	onLogLine?: (line: string, stream: "stdout" | "stderr") => void;
	/**
	 * Initial wallet/budget for this backtest. Used by `deriveMetrics`
	 * to compute `returnPct` (total PnL / wallet) and `drawdownPct`
	 * (peak-to-trough relative to wallet). Passed from the desk's
	 * `budget` field via the MCP handler.
	 */
	wallet?: number;
}

export interface NormalizedResult {
	returnPct: number;
	drawdownPct: number;
	winRate: number;
	totalTrades: number;
	/**
	 * Flat tape of execution events. A managed adapter that only sees
	 * round-trip closed trades emits TWO events per round trip (an open
	 * and a close), each with `time / side / price / amount` and any
	 * supplemental fields (pair, pnl, fees, …) folded into `metadata`.
	 */
	trades: TradeEntry[];
}

/**
 * Adapter-internal: a fully-resolved closed round-trip used to compute
 * universal stats (returnPct / drawdownPct / winRate / totalTrades).
 * `deriveMetrics` turns a list of these into both the stats AND the
 * public `TradeEntry[]` event tape. Adapters reach for this shape only
 * when their source format reports closed round-trips (Freqtrade,
 * Nautilus); event-native sources can build the event tape directly
 * and compute their own stats.
 */
export interface ClosedTrade {
	pair?: string;
	openSide: "buy" | "sell";
	openPrice: number;
	closePrice: number;
	amount: number;
	pnl: number;
	openedAt: string;
	closedAt: string;
}

export type { TradeEntry } from "@quantdesk/shared";

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
	/**
	 * Extra Docker bind mounts to apply on top of the workspace mount.
	 * Same shape as {@link BacktestConfig.extraVolumes} — phase 10.
	 */
	extraVolumes?: string[];
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

export interface PaperTrade {
	id: string;
	pair: string;
	side: "long" | "short";
	openDate: string;
	closeDate: string | null;
	openRate: number;
	closeRate: number | null;
	profitAbs: number;
	profitPct: number;
	isOpen: boolean;
}

export interface PaperCandle {
	time: number; // unix seconds
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface EngineAdapter {
	readonly name: string;
	ensureImage(): Promise<void>;
	downloadData(config: DataConfig): Promise<DataRef>;
	runBacktest(config: BacktestConfig): Promise<BacktestResult>;
	startPaper(config: PaperConfig): Promise<PaperHandle>;
	stopPaper(handle: PaperHandle): Promise<void>;
	getPaperStatus(handle: PaperHandle): Promise<PaperStatus>;
	getPaperTrades?(handle: PaperHandle): Promise<PaperTrade[]>;
	getPaperCandles?(handle: PaperHandle, pair: string, timeframe: string): Promise<PaperCandle[]>;
	/**
	 * Return a single pre-formatted "market tick" log line for the given
	 * pair, or null if the engine has no data to report yet. Used by the
	 * paper-sessions service to inject periodic synthetic lines into the
	 * paper.log stream so the user can see live price + indicator values
	 * alongside the engine's own output — "Bot heartbeat" alone doesn't
	 * prove the bot is actually processing market data, but a line with
	 * a fresh close price and updated indicators does.
	 */
	getPaperMarketTickLine?(
		handle: PaperHandle,
		pair: string,
		timeframe: string,
	): Promise<string | null>;
	parseResult(raw: string): NormalizedResult;
	/**
	 * Files to seed into a freshly-created workspace for this engine.
	 * Keys are workspace-relative paths; values are the file bodies.
	 * The files carry the framework contract (imports, class shape,
	 * required methods) the agent must follow. Engine-specific
	 * knowledge lives entirely inside each adapter's implementation —
	 * the server's workspace service must not hard-code any of it.
	 */
	/**
	 * Seed the workspace. `venue` is required at the type level — the
	 * adapter uses it to stamp exchange-specific fields into config files.
	 * Passing an unknown venue is the caller's job to handle upstream; a
	 * missing venue is a programming error and adapters should throw.
	 */
	workspaceTemplate(opts: { venue: string }): Record<string, string>;
}
