export interface Desk {
	id: string;
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyId: string | null;
	venues: string[];
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

export interface RunResult {
	metrics: Metric[];
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
		| "go_live"
		| "run_stopped";
	actor: string;
	summary: string;
	detail: string | null;
	timestamp: string;
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
	return res.json() as Promise<T>;
}

export const listDesks = () => api<Desk[]>("/desks");
export const getDesk = (id: string) => api<Desk>(`/desks/${id}`);
export const createDesk = (
	data: Partial<Desk> & { adapterType?: string; adapterConfig?: Record<string, unknown> },
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
export const completeAndCreateNewExperiment = (
	experimentId: string,
	data: { title: string; description?: string },
) =>
	api<Experiment>(`/experiments/${experimentId}/complete-and-new`, {
		method: "POST",
		body: JSON.stringify(data),
	});
export const listRuns = (experimentId: string) => api<Run[]>(`/experiments/${experimentId}/runs`);
export const listComments = (experimentId: string) =>
	api<Comment[]>(`/experiments/${experimentId}/comments`);
export const postComment = (experimentId: string, content: string) =>
	api<Comment>(`/experiments/${experimentId}/comments`, {
		method: "POST",
		body: JSON.stringify({ author: "user", content }),
	});

export const listStrategies = (engine?: string) =>
	api<Strategy[]>(`/strategies${engine ? `?engine=${engine}` : ""}`);

export const listActivity = (deskId: string) => api<ActivityItem[]>(`/desks/${deskId}/activity`);

export type AgentLogEntry = { ts: string } & Record<string, unknown>;

export const getAgentLogs = (experimentId: string) =>
	api<AgentLogEntry[]>(`/experiments/${experimentId}/agent/logs`);

export interface Dataset {
	id: string;
	deskId: string;
	exchange: string;
	pairs: string[];
	timeframe: string;
	dateRange: { start: string; end: string };
	path: string;
	createdAt: string;
}

export interface DatasetPreview {
	headers: string[];
	rows: string[][];
	totalRows: number;
	fileSize: number;
}

export const listDatasets = (deskId: string) => api<Dataset[]>(`/desks/${deskId}/datasets`);
export const deleteDataset = (deskId: string, datasetId: string) =>
	api<Dataset>(`/desks/${deskId}/datasets/${datasetId}`, { method: "DELETE" });
export const previewDataset = (deskId: string, datasetId: string, limit = 50) =>
	api<DatasetPreview>(`/desks/${deskId}/datasets/${datasetId}/preview?limit=${limit}`);

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

export const goLive = (runId: string) => api<Run>(`/runs/${runId}/go-live`, { method: "POST" });
export const stopRun = (runId: string) => api<Run>(`/runs/${runId}/stop`, { method: "POST" });
