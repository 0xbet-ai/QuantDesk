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
	/** Extract partial text from a single streaming JSON line, or null if not a text event. */
	parseStreamLine(line: string): string | null;
}
