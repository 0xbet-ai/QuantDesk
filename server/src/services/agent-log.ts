import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Persist agent streaming chunks as JSONL files.
 * Stored at ~/.quantdesk/logs/{experimentId}.jsonl (Paperclip-style home dir storage).
 * Each line is a timestamped StreamChunk from the adapter.
 */

export type AgentLogEntry = { ts: string } & Record<string, unknown>;

const LOGS_DIR = join(homedir(), ".quantdesk", "logs");

function logPath(experimentId: string): string {
	return join(LOGS_DIR, `${experimentId}.jsonl`);
}

function ensureDir(): void {
	if (!existsSync(LOGS_DIR)) {
		mkdirSync(LOGS_DIR, { recursive: true });
	}
}

/** Clear the log file for a new agent run */
export function clearAgentLog(experimentId: string): void {
	ensureDir();
	const path = logPath(experimentId);
	writeFileSync(path, "", "utf-8");
}

/** Append a single entry to the log */
export function appendAgentLog(experimentId: string, entry: AgentLogEntry): void {
	ensureDir();
	const line = `${JSON.stringify(entry)}\n`;
	appendFileSync(logPath(experimentId), line, "utf-8");
	// In dev, also mirror a compact one-line summary to stdout so the
	// developer doesn't have to juggle `tail -f jsonl | jq` in a second
	// terminal. Silent in production.
	if (process.env.NODE_ENV !== "production") {
		const summary = summarizeEntry(entry);
		if (summary) {
			process.stdout.write(`[agent ${experimentId.slice(0, 8)}] ${summary}\n`);
		}
	}
}

/**
 * Compact one-line human-readable summary of a stream chunk for dev
 * console mirroring. Full body stays in the JSONL file — `tail -f` with
 * `jq` is still the source of truth for detailed inspection.
 */
function summarizeEntry(entry: AgentLogEntry): string | null {
	const type = typeof entry.type === "string" ? entry.type : "";
	const preview = (s: unknown, max = 140): string => {
		if (typeof s !== "string") return "";
		const flat = s.replace(/\s+/g, " ").trim();
		return flat.length > max ? `${flat.slice(0, max)}…` : flat;
	};

	switch (type) {
		case "init": {
			const model = typeof entry.model === "string" ? entry.model : "?";
			return `init           model=${model}`;
		}
		case "thinking":
			return `thinking       ${preview(entry.content, 100)}`;
		case "text":
			return `text           ${preview(entry.content, 140)}`;
		case "tool_call": {
			const name = typeof entry.name === "string" ? entry.name : "?";
			let inputStr = "";
			try {
				inputStr = JSON.stringify(entry.input);
			} catch {
				inputStr = "<unserializable>";
			}
			return `tool_call      ${name} ${preview(inputStr, 160)}`;
		}
		case "tool_result": {
			const isError = entry.isError === true;
			const tag = isError ? "tool_result ✗ " : "tool_result ✓ ";
			// On error, surface the full body (truncated to 400) so the
			// failure reason is visible without switching terminals.
			const max = isError ? 400 : 140;
			return `${tag} ${preview(entry.content, max)}`;
		}
		case "result": {
			const isError = entry.isError === true;
			const inTok = typeof entry.inputTokens === "number" ? entry.inputTokens : 0;
			const outTok = typeof entry.outputTokens === "number" ? entry.outputTokens : 0;
			const cost =
				typeof entry.costUsd === "number" && entry.costUsd > 0
					? ` cost=$${entry.costUsd.toFixed(4)}`
					: "";
			const status = isError ? "✗" : "✓";
			return `result ${status}       in=${inTok} out=${outTok}${cost}`;
		}
		case "stdout":
			return `stdout         ${preview(entry.content, 200)}`;
		case "system":
			return `system         ${preview(entry.content, 160)}`;
		default:
			return null;
	}
}

/** Read all log entries for an experiment */
export function readAgentLog(experimentId: string): AgentLogEntry[] {
	const path = logPath(experimentId);
	if (!existsSync(path)) return [];

	const content = readFileSync(path, "utf-8");
	const entries: AgentLogEntry[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as AgentLogEntry);
		} catch {
			// skip malformed lines
		}
	}
	return entries;
}
