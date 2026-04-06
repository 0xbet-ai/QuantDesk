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

export interface Run {
	id: string;
	experimentId: string;
	runNumber: number;
	isBaseline: boolean;
	mode: string;
	status: string;
	config: Record<string, unknown>;
	result: { returnPct: number; drawdownPct: number; winRate: number; totalTrades: number } | null;
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

export interface Strategy {
	id: string;
	name: string;
	category: string;
	difficulty: string;
	description: string;
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
export const createDesk = (data: Partial<Desk>) =>
	api<{ desk: Desk; experiment: Experiment }>("/desks", {
		method: "POST",
		body: JSON.stringify(data),
	});

export const listExperiments = (deskId: string) =>
	api<Experiment[]>(`/desks/${deskId}/experiments`);
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

export const goLive = (runId: string) => api<Run>(`/runs/${runId}/go-live`, { method: "POST" });
export const stopRun = (runId: string) => api<Run>(`/runs/${runId}/stop`, { method: "POST" });
