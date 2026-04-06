export interface SpawnResult {
	sessionId: string;
	resultText: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		costUsd?: number;
	};
}

export interface AgentAdapter {
	readonly name: string;
	buildSpawnArgs(prompt: string, sessionId?: string): string[];
	parseOutputStream(lines: string[]): SpawnResult;
}
