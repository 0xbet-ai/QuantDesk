export interface SpawnResult {
	sessionId: string;
	resultText: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		costUsd?: number;
	};
}

export type StreamChunk =
	| { type: "text"; content: string }
	| { type: "thinking"; content: string }
	| {
			type: "tool_call";
			name: string;
			toolUseId?: string;
			input: unknown;
	  }
	| {
			type: "tool_result";
			toolUseId: string;
			content: string;
			isError: boolean;
	  }
	| { type: "init"; model: string; sessionId: string }
	| {
			type: "result";
			content: string;
			inputTokens: number;
			outputTokens: number;
			costUsd: number;
			isError: boolean;
	  }
	| { type: "system"; content: string }
	| { type: "stdout"; content: string };

export interface AgentAdapter {
	readonly name: string;
	buildSpawnArgs(
		prompt: string,
		sessionId?: string,
		mcpConfigPath?: string,
		settingsPath?: string,
	): string[];
	parseOutputStream(lines: string[]): SpawnResult;
	/** Extract structured chunk from a streaming JSON line, or null if not relevant. */
	parseStreamLine(line: string): StreamChunk | null;
}
