export interface SpawnResult {
	sessionId: string;
	resultText: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		costUsd?: number;
	};
}

export interface StreamChunk {
	type: "text" | "tool" | "tool_result";
	content: string;
	/** Tool name (e.g. "Write", "Bash") */
	tool?: string;
	/** Short label (e.g. "Writing", "Running") */
	label?: string;
	/** File path or command */
	detail?: string;
	/** Full tool input for expandable view */
	expandable?: string;
}

export interface AgentAdapter {
	readonly name: string;
	buildSpawnArgs(prompt: string, sessionId?: string): string[];
	parseOutputStream(lines: string[]): SpawnResult;
	/** Extract structured chunk from a streaming JSON line, or null if not relevant. */
	parseStreamLine(line: string): StreamChunk | null;
}
