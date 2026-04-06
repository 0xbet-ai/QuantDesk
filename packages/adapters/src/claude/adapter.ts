import type { AgentAdapter, SpawnResult, StreamChunk } from "../types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

interface ClaudeResultEvent {
	type: "result";
	result: string;
	session_id: string;
	usage: { input_tokens: number; output_tokens: number };
	total_cost_usd?: number;
}

export class ClaudeAdapter implements AgentAdapter {
	readonly name = "claude";

	buildSpawnArgs(_prompt: string, sessionId?: string): string[] {
		const args = [
			"claude",
			"-p",
			"-",
			"--output-format",
			"stream-json",
			"--verbose",
			"--dangerously-skip-permissions",
		];
		if (sessionId) {
			args.push("--resume", sessionId);
		}
		return args;
	}

	parseStreamLine(line: string): StreamChunk | null {
		if (!line.trim()) return null;

		const parsed = asRecord(safeJsonParse(line));
		if (!parsed) return { type: "stdout", content: line };

		const eventType = typeof parsed.type === "string" ? parsed.type : "";

		// ── system init ──
		if (eventType === "system" && parsed.subtype === "init") {
			return {
				type: "init",
				model: typeof parsed.model === "string" ? parsed.model : "unknown",
				sessionId: typeof parsed.session_id === "string" ? parsed.session_id : "",
			};
		}

		// ── system events — skip internal noise (hooks, turn started) ──
		if (eventType === "system") {
			return null;
		}

		// ── assistant message ──
		if (eventType === "assistant") {
			const message = asRecord(parsed.message) ?? {};
			const content = Array.isArray(message.content) ? message.content : [];

			for (const blockRaw of content) {
				const block = asRecord(blockRaw);
				if (!block) continue;
				const blockType = typeof block.type === "string" ? block.type : "";

				if (blockType === "text") {
					const text = typeof block.text === "string" ? block.text : "";
					if (text) return { type: "text", content: text };
				}

				if (blockType === "thinking") {
					const text = typeof block.thinking === "string" ? block.thinking : "";
					if (text) return { type: "thinking", content: text };
				}

				if (blockType === "tool_use") {
					return {
						type: "tool_call",
						name: typeof block.name === "string" ? block.name : "unknown",
						toolUseId:
							typeof block.id === "string"
								? block.id
								: typeof block.tool_use_id === "string"
									? (block.tool_use_id as string)
									: undefined,
						input: block.input ?? {},
					};
				}
			}
			return null;
		}

		// ── user message (tool results) ──
		if (eventType === "user") {
			const message = asRecord(parsed.message) ?? {};
			const content = Array.isArray(message.content) ? message.content : [];

			for (const blockRaw of content) {
				const block = asRecord(blockRaw);
				if (!block) continue;
				const blockType = typeof block.type === "string" ? block.type : "";

				if (blockType === "tool_result") {
					const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
					const isError = block.is_error === true;
					let text = "";
					if (typeof block.content === "string") {
						text = block.content;
					} else if (Array.isArray(block.content)) {
						const parts: string[] = [];
						for (const part of block.content) {
							const p = asRecord(part);
							if (p && typeof p.text === "string") parts.push(p.text as string);
						}
						text = parts.join("\n");
					}
					return {
						type: "tool_result",
						toolUseId,
						content: text.slice(0, 500),
						isError,
					};
				}
			}
			return null;
		}

		// ── result ──
		if (eventType === "result") {
			const usage = asRecord(parsed.usage) ?? {};
			return {
				type: "result",
				content: typeof parsed.result === "string" ? parsed.result : "",
				inputTokens: asNumber(usage.input_tokens),
				outputTokens: asNumber(usage.output_tokens),
				costUsd: asNumber(parsed.total_cost_usd),
				isError: parsed.is_error === true,
			};
		}

		return null;
	}

	parseOutputStream(lines: string[]): SpawnResult {
		let sessionId = "";
		let resultText = "";
		let inputTokens = 0;
		let outputTokens = 0;
		let costUsd: number | undefined;

		for (const line of lines) {
			if (!line.trim()) continue;
			const parsed = asRecord(safeJsonParse(line));
			if (!parsed) continue;

			if (parsed.type === "system" && typeof parsed.session_id === "string") {
				sessionId = parsed.session_id;
			}

			if (parsed.type === "result") {
				const event = parsed as unknown as ClaudeResultEvent;
				resultText = event.result;
				sessionId = event.session_id;
				inputTokens = event.usage.input_tokens;
				outputTokens = event.usage.output_tokens;
				costUsd = event.total_cost_usd;
			}
		}

		if (!sessionId) {
			throw new Error("Failed to parse Claude output: no session_id found");
		}

		return {
			sessionId,
			resultText,
			usage: { inputTokens, outputTokens, costUsd },
		};
	}
}
