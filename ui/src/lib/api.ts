export type StrategyMode = "classic" | "realtime";

export interface Desk {
	id: string;
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyId: string | null;
	venues: string[];
	strategyMode: StrategyMode;
	engine: string;
	config: Record<string, unknown>;
	description: string | null;
	status: string;
	createdAt: string;
	updatedAt: string;
}

export interface Experiment {
	id: string;
	deskId: string;
	number: number;
	title: string;
	description: string | null;
	status: string;
	createdAt: string;
	updatedAt: string;
}

export interface Metric {
	key: string;
	label: string;
	value: number;
	format: "percent" | "number" | "integer" | "currency";
	tone?: "positive" | "negative" | "neutral";
}

export interface RunValidation {
	verdict: "approve" | "reject";
	reason?: string | null;
	at: string;
}

export interface TradeLogEntry {
	pair: string;
	side: "buy" | "sell";
	price: number;
	amount: number;
	pnl: number;
	openedAt: string;
	closedAt: string;
}

export interface RunResult {
	metrics: Metric[];
	trades?: TradeLogEntry[];
	validation?: RunValidation;
}

export interface Run {
	id: string;
	experimentId: string;
	runNumber: number;
	isBaseline: boolean;
	mode: string;
	status: string;
	config: Record<string, unknown>;
	result: RunResult | null;
	commitHash: string | null;
	datasetId: string | null;
	error: string | null;
	createdAt: string;
	completedAt: string | null;
}

export interface Comment {
	id: string;
	experimentId: string;
	author: string;
	content: string;
	runId: string | null;
	turnId: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
}

export interface ActivityItem {
	id: string;
	type:
		| "experiment_created"
		| "run_created"
		| "run_completed"
		| "run_failed"
		| "comment"
		| "go_paper"
		| "run_stopped";
	actor: string;
	summary: string;
	detail: string | null;
	timestamp: string;
	experimentId: string;
	commentId: string | null;
}

export interface Strategy {
	id: string;
	name: string;
	category: string;
	difficulty: string;
	description: string;
	summary?: string;
	indicators: string[];
	defaultParams: Record<string, unknown>;
	timeframes: string[];
	engine: string;
	source: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api${path}`, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: "Request failed" }));
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

export const listDesks = () => api<Desk[]>("/desks");
export const getDesk = (id: string) => api<Desk>(`/desks/${id}`);
export interface ExternalMountInput {
	label: string;
	hostPath: string;
	description?: string;
}

export interface FsBrowseEntry {
	name: string;
	path: string;
}

export interface FsBrowseResponse {
	path: string;
	parent: string | null;
	entries: FsBrowseEntry[];
}

export const browseFs = (path?: string) =>
	api<FsBrowseResponse>(`/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`);

export const createDesk = (
	data: Partial<Desk> & {
		adapterType?: string;
		adapterConfig?: Record<string, unknown>;
		seedCodePath?: string;
		externalMounts?: ExternalMountInput[];
		reusedDatasetIds?: string[];
	},
) =>
	api<{ desk: Desk; experiment: Experiment }>("/desks", {
		method: "POST",
		body: JSON.stringify(data),
	});

export const updateDesk = (id: string, data: Partial<Desk>) =>
	api<Desk>(`/desks/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const archiveDesk = (id: string) => api<Desk>(`/desks/${id}/archive`, { method: "POST" });

export const listExperiments = (deskId: string) =>
	api<Experiment[]>(`/desks/${deskId}/experiments`);
export const listActiveExperiments = (deskId: string) =>
	api<string[]>(`/desks/${deskId}/active-experiments`);
export const completeAndCreateNewExperiment = (
	experimentId: string,
	data: { title: string; description?: string },
) =>
	api<Experiment>(`/experiments/${experimentId}/complete-and-new`, {
		method: "POST",
		body: JSON.stringify(data),
	});
export const deleteExperiment = (experimentId: string) =>
	api<void>(`/experiments/${experimentId}`, { method: "DELETE" });
export const listRuns = (experimentId: string) => api<Run[]>(`/experiments/${experimentId}/runs`);

export interface AgentTurnRow {
	id: string;
	experimentId: string;
	deskId: string;
	agentRole: string;
	triggerKind: string;
	status: "running" | "completed" | "failed" | "stopped" | "awaiting_validation";
	startedAt: string;
	endedAt: string | null;
	lastHeartbeatAt: string;
	failureReason: string | null;
}

export interface TurnDetail {
	turn: AgentTurnRow;
	comments: Comment[];
	runs: Run[];
}

export const getTurn = (turnId: string) => api<TurnDetail>(`/turns/${turnId}`);
export const listExperimentTurns = (experimentId: string) =>
	api<AgentTurnRow[]>(`/experiments/${experimentId}/turns`);
export const listComments = (experimentId: string) =>
	api<Comment[]>(`/experiments/${experimentId}/comments`);
export const postComment = (
	experimentId: string,
	content: string,
	metadata?: Record<string, unknown>,
) => {
	const author = metadata?.systemAuthor ? "system" : "user";
	const cleanMeta = metadata ? { ...metadata } : undefined;
	if (cleanMeta) cleanMeta.systemAuthor = undefined;
	return api<Comment>(`/experiments/${experimentId}/comments`, {
		method: "POST",
		body: JSON.stringify({
			author,
			content,
			...(cleanMeta && Object.keys(cleanMeta).length > 0 ? { metadata: cleanMeta } : {}),
		}),
	});
};

export const listStrategies = (engine?: string) =>
	api<Strategy[]>(`/strategies${engine ? `?engine=${engine}` : ""}`);

export const listActivity = (deskId: string) => api<ActivityItem[]>(`/desks/${deskId}/activity`);

export type AgentLogEntry = { ts: string } & Record<string, unknown>;

export const getAgentLogs = (experimentId: string) =>
	api<AgentLogEntry[]>(`/experiments/${experimentId}/agent/logs`);

export interface Dataset {
	id: string;
	exchange: string;
	pairs: string[];
	timeframe: string;
	/** "futures" covers perpetual swaps/perps; "spot" / "margin" are the
	 *  other two modes. Matches `DataFetchRequest.tradingMode` on the
	 *  shared package. */
	tradingMode: "spot" | "futures" | "margin";
	dateRange: { start: string; end: string };
	path: string;
	createdAt: string;
	createdByDeskId?: string | null;
	createdByExperimentId?: string | null;
	createdByDeskName?: string | null;
	createdByExperimentTitle?: string | null;
	createdByExperimentNumber?: number | null;
}

export interface DatasetPreview {
	headers: string[];
	rows: string[][];
	totalRows: number;
	fileSize: number;
}

export const listDatasets = (deskId: string) => api<Dataset[]>(`/desks/${deskId}/datasets`);
/** Global catalog across all desks — used by the desk-creation wizard's
 *  "Reuse existing datasets" picker so the user can attach previously
 *  downloaded data to a new desk without a fresh download. */
export const listAllDatasets = () => api<Dataset[]>("/datasets");
export const deleteDataset = (deskId: string, datasetId: string) =>
	api<Dataset>(`/desks/${deskId}/datasets/${datasetId}`, { method: "DELETE" });
export const previewDataset = (deskId: string, datasetId: string, limit = 50) =>
	api<DatasetPreview>(`/desks/${deskId}/datasets/${datasetId}/preview?limit=${limit}`);
export const previewDatasetGlobal = (datasetId: string, limit = 50) =>
	api<DatasetPreview>(`/datasets/${datasetId}/preview?limit=${limit}`);

export interface CommitInfo {
	hash: string;
	message: string;
	date: string;
}

export const getCodeLog = (deskId: string) => api<CommitInfo[]>(`/desks/${deskId}/code/log`);
export const getCodeFiles = (deskId: string, commit?: string) =>
	api<string[]>(`/desks/${deskId}/code/files${commit ? `?commit=${commit}` : ""}`);
export const getCodeFile = async (
	deskId: string,
	path: string,
	commit?: string,
): Promise<string> => {
	const params = new URLSearchParams({ path });
	if (commit) params.set("commit", commit);
	const res = await fetch(`/api/desks/${deskId}/code/file?${params}`);
	if (!res.ok) throw new Error("Failed to fetch file");
	return res.text();
};

export const getCodeDiff = async (deskId: string, from: string, to: string): Promise<string> => {
	const params = new URLSearchParams({ from, to });
	const res = await fetch(`/api/desks/${deskId}/code/diff?${params}`);
	if (!res.ok) throw new Error("Failed to fetch diff");
	return res.text();
};

export const goPaper = (runId: string) => api<Run>(`/runs/${runId}/go-paper`, { method: "POST" });
export const stopRun = (runId: string) => api<Run>(`/runs/${runId}/stop`, { method: "POST" });

// Paper trading
export interface PaperSession {
	id: string;
	deskId: string;
	runId: string;
	experimentId: string;
	engine: string;
	containerName: string | null;
	status: "pending" | "running" | "stopped" | "failed";
	apiPort: number | null;
	meta: Record<string, unknown> | null;
	error: string | null;
	startedAt: string;
	stoppedAt: string | null;
	lastStatusAt: string | null;
}

export const getPaperSession = (deskId: string) =>
	api<PaperSession | null>(`/desks/${deskId}/paper`);
export const getActivePaperSession = (deskId: string) =>
	api<PaperSession | null>(`/desks/${deskId}/paper/active`);
export const stopPaperSession = (deskId: string) =>
	api<{ stopped: boolean; sessionId: string }>(`/desks/${deskId}/paper/stop`, { method: "POST" });

export interface PaperStatusData {
	running: boolean;
	unrealizedPnl: number;
	realizedPnl: number;
	openPositions: number;
	uptime: number;
}

export const getPaperStatus = (deskId: string) =>
	api<PaperStatusData | null>(`/desks/${deskId}/paper/status`);

export interface PaperTradeItem {
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

export interface PaperCandleItem {
	time: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export const getPaperTrades = (deskId: string) =>
	api<PaperTradeItem[]>(`/desks/${deskId}/paper/trades`);
export const getPaperCandles = (deskId: string, pair: string, timeframe: string) =>
	api<PaperCandleItem[]>(
		`/desks/${deskId}/paper/candles?pair=${encodeURIComponent(pair)}&timeframe=${encodeURIComponent(timeframe)}`,
	);
