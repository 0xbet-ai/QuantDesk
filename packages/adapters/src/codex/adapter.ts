import type { AgentAdapter, SpawnResult, StreamChunk } from "../types.js";

function safeJsonParse(line: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(line);
		if (typeof v === "object" && v !== null && !Array.isArray(v)) {
			return v as Record<string, unknown>;
		}
	} catch {
		/* ignore */
	}
	return null;
}

function asString(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export class CodexAdapter implements AgentAdapter {
	readonly name = "codex";

	buildSpawnArgs(
		prompt: string,
		sessionId?: string,
		_mcpConfigPath?: string,
		_settingsPath?: string,
	): string[] {
		if (sessionId) {
			return ["codex", "exec", "--json", "resume", sessionId, "-"];
		}
		return ["codex", "exec", "--json", prompt];
	}

	parseStreamLine(line: string): StreamChunk | null {
		if (!line.trim()) return null;
		const event = safeJsonParse(line);
		if (!event) return null;

		const eventType = asString(event.type);
		const item =
			typeof event.item === "object" && event.item !== null
				? (event.item as Record<string, unknown>)
				: null;
		const itemType = item ? asString(item.type) : "";

		// thread.started → init
		if (eventType === "thread.started") {
			return {
				type: "init",
				model: "codex",
				sessionId: asString(event.thread_id),
			};
		}

		// item.started → show tool_call for command_execution, or text hint for reasoning
		if (eventType === "item.started" && item) {
			if (itemType === "command_execution") {
				return {
					type: "tool_call",
					name: "shell",
					input: { command: asString(item.command) },
				};
			}
			if (itemType === "tool_use") {
				return {
					type: "tool_call",
					name: asString(item.name) || "tool",
					toolUseId: asString(item.id),
					input: item.input ?? {},
				};
			}
		}

		// item.completed → text content for agent_message and reasoning
		if (eventType === "item.completed" && item) {
			if (itemType === "agent_message" || itemType === "reasoning") {
				const text = asString(item.text);
				if (text) return { type: "text", content: text };
			}
			if (itemType === "command_execution") {
				const output = asString(item.output);
				if (output) {
					return {
						type: "tool_result",
						toolUseId: asString(item.id),
						content: output,
						isError: item.exit_code !== 0,
					};
				}
			}
			if (itemType === "tool_result") {
				const output = asString(item.output) || asString(item.text);
				if (output) {
					return {
						type: "tool_result",
						toolUseId: asString(item.tool_use_id),
						content: output,
						isError: item.is_error === true,
					};
				}
			}
		}

		// turn.completed → result with usage
		if (eventType === "turn.completed") {
			const usage =
				typeof event.usage === "object" && event.usage !== null
					? (event.usage as Record<string, unknown>)
					: {};
			return {
				type: "result",
				content: "",
				inputTokens: asNumber(usage.input_tokens),
				outputTokens: asNumber(usage.output_tokens),
				costUsd: asNumber(event.total_cost_usd),
				isError: false,
			};
		}

		// error
		if (eventType === "error" || eventType === "turn.failed") {
			const msg = asString(event.message) || asString(event.error) || "Unknown Codex error";
			return { type: "text", content: `[Codex error] ${msg}` };
		}

		return null;
	}

	parseOutputStream(lines: string[]): SpawnResult {
		let threadId = "";
		let resultText = "";
		let inputTokens = 0;
		let outputTokens = 0;
		let costUsd: number | undefined;

		for (const line of lines) {
			if (!line.trim()) continue;
			const event = safeJsonParse(line);
			if (!event) continue;

			const eventType = asString(event.type);

			if (eventType === "thread.started") {
				threadId = asString(event.thread_id);
			}

			if (eventType === "item.completed") {
				const item =
					typeof event.item === "object" && event.item !== null
						? (event.item as Record<string, unknown>)
						: null;
				if (item) {
					const itemType = asString(item.type);
					if (itemType === "agent_message") {
						resultText = asString(item.text);
					}
				}
			}

			if (eventType === "turn.completed") {
				const usage =
					typeof event.usage === "object" && event.usage !== null
						? (event.usage as Record<string, unknown>)
						: {};
				inputTokens = asNumber(usage.input_tokens);
				outputTokens = asNumber(usage.output_tokens);
				costUsd = asNumber(event.total_cost_usd) || undefined;
			}
		}

		if (!threadId) {
			throw new Error("Failed to parse Codex output: no thread_id found");
		}

		return {
			sessionId: threadId,
			resultText,
			usage: { inputTokens, outputTokens, costUsd },
		};
	}
}
