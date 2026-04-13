/**
 * HTTP generic adapter — calls any LLM proxy (Ollama, LiteLLM, vLLM,
 * OpenRouter, etc.) via a standard HTTP POST with JSON body.
 *
 * Unlike the CLI adapters, this one runs entirely in-process (no
 * subprocess). The "stream" is faked: we call the endpoint, wait for
 * the response, and emit a single "result" chunk. True SSE streaming
 * can be added later if needed.
 *
 * Config is stored in `agentSessions.adapterConfig`:
 *   {
 *     url: "http://localhost:11434/api/chat",   // required
 *     model: "llama3",                           // optional
 *     headers: { "Authorization": "Bearer ..." } // optional
 *   }
 *
 * The adapter sends the prompt as a chat-completions-style payload
 * and expects a JSON response with `message.content` or `response`
 * field.
 */

import type { AgentAdapter, SpawnResult, StreamChunk } from "../types.js";

export class HttpAdapter implements AgentAdapter {
	readonly name = "http";

	buildSpawnArgs(
		prompt: string,
		sessionId?: string,
		_mcpConfigPath?: string,
		_settingsPath?: string,
	): string[] {
		// The HTTP adapter doesn't spawn a subprocess — the prompt and
		// sessionId are passed through the args array and consumed by
		// the custom spawn function in agent-trigger.ts. The first
		// element is the "command" (used as a marker), the rest carry
		// the payload.
		return ["__http_adapter__", prompt, sessionId ?? ""];
	}

	parseStreamLine(line: string): StreamChunk | null {
		// HTTP adapter doesn't produce streaming lines — it returns the
		// full response in one shot via parseOutputStream. This method
		// is only called if someone pipes stdout lines from a wrapper
		// script; treat each line as plain text.
		if (!line.trim()) return null;
		return { type: "text", content: line };
	}

	parseOutputStream(lines: string[]): SpawnResult {
		// The HTTP adapter's "output" is the JSON response body from the
		// LLM proxy, passed as a single line. Try to parse it.
		const joined = lines.join("\n").trim();
		if (!joined) {
			return {
				sessionId: "http-session",
				resultText: "",
				usage: { inputTokens: 0, outputTokens: 0 },
				
			};
		}

		try {
			const data = JSON.parse(joined) as Record<string, unknown>;

			// OpenAI chat-completions format
			const choices = Array.isArray(data.choices) ? data.choices : [];
			if (choices.length > 0) {
				const msg = (choices[0] as Record<string, unknown>)?.message as
					| Record<string, unknown>
					| undefined;
				const content = typeof msg?.content === "string" ? msg.content : "";
				const usage = data.usage as Record<string, unknown> | undefined;
				return {
					sessionId: (typeof data.id === "string" ? data.id : "") || "http-session",
					resultText: content,
					usage: {
						inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
						outputTokens:
							typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
					},
				};
			}

			// Ollama format
			if (typeof data.response === "string") {
				return {
					sessionId: "http-session",
					resultText: data.response,
					usage: { inputTokens: 0, outputTokens: 0 },
				};
			}

			// Anthropic Messages format
			const content = Array.isArray(data.content) ? data.content : [];
			if (content.length > 0) {
				const text = content
					.filter((b: unknown) => (b as Record<string, unknown>)?.type === "text")
					.map((b: unknown) => (b as Record<string, string>).text ?? "")
					.join("\n");
				const usage = data.usage as Record<string, unknown> | undefined;
				return {
					sessionId: (typeof data.id === "string" ? data.id : "") || "http-session",
					resultText: text,
					usage: {
						inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
						outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
					},
				};
			}

			// Fallback: raw text
			return {
				sessionId: "http-session",
				resultText: joined,
				usage: { inputTokens: 0, outputTokens: 0 },
			};
		} catch {
			// Not JSON — treat as raw text response
			return {
				sessionId: "http-session",
				resultText: joined,
				usage: { inputTokens: 0, outputTokens: 0 },
			};
		}
	}
}
