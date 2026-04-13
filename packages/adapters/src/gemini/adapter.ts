/**
 * Gemini CLI adapter — `gemini --output-format stream-json`.
 *
 * Stream format (JSONL, one event per line):
 *   - { type: "assistant", message: { content: [{ type: "text", text: "..." }] } }
 *   - { type: "text", part: { text: "..." } }
 *   - { type: "result", result: "...", session_id: "...", usage: { input_tokens, output_tokens } }
 *   - { type: "system", subtype: "init", session_id: "..." }
 *   - { type: "error", error: "..." }
 *
 * Derived from Paperclip's `adapter-gemini-local` stream parser.
 */

import type { AgentAdapter, SpawnResult, StreamChunk } from "../types.js";

interface GeminiResultEvent {
	type: "result";
	result?: string;
	text?: string;
	response?: string;
	session_id?: string;
	sessionId?: string;
	checkpoint_id?: string;
	is_error?: boolean;
	error?: string | { message?: string };
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		promptTokenCount?: number;
		candidatesTokenCount?: number;
	};
	total_cost_usd?: number;
	cost_usd?: number;
}

function safeJsonParse(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readSessionId(event: Record<string, unknown>): string | null {
	for (const key of ["session_id", "sessionId", "sessionID", "checkpoint_id", "thread_id"]) {
		const val = event[key];
		if (typeof val === "string" && val.trim()) return val.trim();
	}
	return null;
}

export class GeminiAdapter implements AgentAdapter {
	readonly name = "gemini";

	buildSpawnArgs(
		prompt: string,
		sessionId?: string,
		mcpConfigPath?: string,
		_settingsPath?: string,
	): string[] {
		const args = ["gemini", "--output-format", "stream-json"];
		if (sessionId) {
			args.push("--resume", sessionId);
		}
		args.push("--approval-mode", "yolo");
		args.push("--sandbox=none");
		if (mcpConfigPath) {
			args.push("--mcp-config", mcpConfigPath);
		}
		args.push("--prompt", prompt);
		return args;
	}

	parseStreamLine(line: string): StreamChunk | null {
		if (!line.trim()) return null;

		const parsed = asRecord(safeJsonParse(line));
		if (!parsed) return { type: "stdout", content: line };

		const eventType = typeof parsed.type === "string" ? parsed.type : "";
		const sessionId = readSessionId(parsed);

		// ── system init ──
		if (eventType === "system") {
			if (sessionId) {
				return { type: "init", model: "gemini", sessionId };
			}
			return null;
		}

		// ── assistant message (text block) ──
		if (eventType === "assistant") {
			const message = asRecord(parsed.message) ?? {};
			const content = Array.isArray(message.content) ? message.content : [];
			for (const blockRaw of content) {
				const block = asRecord(blockRaw);
				if (!block) continue;
				const blockType = typeof block.type === "string" ? block.type : "";
				if (blockType === "text" || blockType === "output_text" || blockType === "content") {
					const text =
						(typeof block.text === "string" ? block.text : "") ||
						(typeof block.content === "string" ? block.content : "");
					if (text) return { type: "text", content: text };
				}
				if (blockType === "tool_use") {
					return {
						type: "tool_call",
						name: typeof block.name === "string" ? block.name : "unknown",
						toolUseId: typeof block.id === "string" ? block.id : undefined,
						input: block.input ?? {},
					};
				}
			}
			// Fallback: try direct text field
			const directText = typeof message.text === "string" ? message.text.trim() : "";
			if (directText) return { type: "text", content: directText };
			return null;
		}

		// ── text event (standalone) ──
		if (eventType === "text") {
			const part = asRecord(parsed.part) ?? {};
			const text = typeof part.text === "string" ? part.text.trim() : "";
			if (text) return { type: "text", content: text };
			return null;
		}

		// ── tool results ──
		if (eventType === "user") {
			const message = asRecord(parsed.message) ?? {};
			const content = Array.isArray(message.content) ? message.content : [];
			for (const blockRaw of content) {
				const block = asRecord(blockRaw);
				if (!block) continue;
				if (typeof block.type === "string" && block.type === "tool_result") {
					const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
					let text = "";
					if (typeof block.content === "string") text = block.content;
					else if (Array.isArray(block.content)) {
						text = (block.content as Array<{ text?: string }>).map((p) => p.text ?? "").join("\n");
					}
					return {
						type: "tool_result",
						toolUseId,
						content: text,
						isError: block.is_error === true,
					};
				}
			}
			return null;
		}

		// ── result ──
		if (eventType === "result") {
			const event = parsed as unknown as GeminiResultEvent;
			const usage = event.usage ?? {};
			return {
				type: "result",
				content:
					(typeof event.result === "string" ? event.result : "") ||
					(typeof event.text === "string" ? event.text : "") ||
					(typeof event.response === "string" ? event.response : ""),
				inputTokens: asNumber(usage.input_tokens ?? usage.promptTokenCount),
				outputTokens: asNumber(usage.output_tokens ?? usage.candidatesTokenCount),
				costUsd: asNumber(event.total_cost_usd ?? event.cost_usd),
				isError: event.is_error === true,
			};
		}

		// ── error ──
		if (eventType === "error") {
			const errMsg =
				typeof parsed.error === "string"
					? parsed.error
					: typeof (parsed.error as Record<string, unknown> | null)?.message === "string"
						? (parsed.error as { message: string }).message
						: "Unknown Gemini error";
			return { type: "text", content: `[Gemini error] ${errMsg}` };
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

			const sid = readSessionId(parsed);
			if (sid) sessionId = sid;

			if (parsed.type === "result") {
				const event = parsed as unknown as GeminiResultEvent;
				resultText =
					(typeof event.result === "string" ? event.result : "") ||
					(typeof event.text === "string" ? event.text : "") ||
					(typeof event.response === "string" ? event.response : "");
				if (sid) sessionId = sid;
				const usage = event.usage ?? {};
				inputTokens = asNumber(usage.input_tokens ?? usage.promptTokenCount);
				outputTokens = asNumber(usage.output_tokens ?? usage.candidatesTokenCount);
				costUsd = asNumber(event.total_cost_usd ?? event.cost_usd) || undefined;
			}
		}

		if (!sessionId) {
			throw new Error("Failed to parse Gemini output: no session_id found");
		}

		return {
			sessionId,
			resultText,
			usage: { inputTokens, outputTokens, costUsd },
		};
	}
}
