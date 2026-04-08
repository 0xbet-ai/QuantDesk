import type { AgentAdapter, SpawnResult, StreamChunk } from "../types.js";

interface CodexThreadStarted {
	type: "thread.started";
	thread_id: string;
}

interface CodexItemCompleted {
	type: "item.completed";
	item: { text: string };
}

interface CodexTurnCompleted {
	type: "turn.completed";
	usage: { input_tokens: number; output_tokens: number };
}

type CodexEvent = CodexThreadStarted | CodexItemCompleted | CodexTurnCompleted;

export class CodexAdapter implements AgentAdapter {
	readonly name = "codex";

	buildSpawnArgs(prompt: string, sessionId?: string, _mcpConfigPath?: string): string[] {
		if (sessionId) {
			return ["codex", "exec", "--json", "resume", sessionId, "-"];
		}
		return ["codex", "exec", "--json", prompt];
	}

	parseStreamLine(line: string): StreamChunk | null {
		if (!line.trim()) return null;
		try {
			const event: CodexEvent = JSON.parse(line);
			if (event.type === "item.completed" && "item" in event) {
				return { type: "text", content: event.item.text };
			}
		} catch {
			/* ignore */
		}
		return null;
	}

	parseOutputStream(lines: string[]): SpawnResult {
		let threadId = "";
		let resultText = "";
		let inputTokens = 0;
		let outputTokens = 0;

		for (const line of lines) {
			if (!line.trim()) continue;
			let event: CodexEvent;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}

			if (event.type === "thread.started") {
				threadId = event.thread_id;
			}

			if (event.type === "item.completed" && "item" in event) {
				resultText = event.item.text;
			}

			if (event.type === "turn.completed") {
				inputTokens = event.usage.input_tokens;
				outputTokens = event.usage.output_tokens;
			}
		}

		if (!threadId) {
			throw new Error("Failed to parse Codex output: no thread_id found");
		}

		return {
			sessionId: threadId,
			resultText,
			usage: { inputTokens, outputTokens },
		};
	}
}
