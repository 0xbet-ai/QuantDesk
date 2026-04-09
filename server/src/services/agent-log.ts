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
			const prefix = color(`[agent ${experimentId.slice(0, 8)}]`, "gray");
			process.stdout.write(`${prefix} ${summary}\n`);
		}
	}
}

// ── ANSI color helpers ───────────────────────────────────────────────
// Colors are enabled when stdout is a TTY and `NO_COLOR` is not set.
// Keeps CI / piped output clean while giving devs a readable stream.
const COLOR_ENABLED = process.stdout.isTTY && !process.env.NO_COLOR;
const ANSI = {
	reset: "\x1b[0m",
	gray: "\x1b[90m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
} as const;
type ColorName = keyof typeof ANSI;

function color(text: string, name: ColorName): string {
	return COLOR_ENABLED ? `${ANSI[name]}${text}${ANSI.reset}` : text;
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
			return `${color("init          ", "magenta")} ${color(`model=${model}`, "dim")}`;
		}
		case "thinking":
			return `${color("thinking      ", "dim")} ${color(preview(entry.content, 100), "dim")}`;
		case "text":
			return `${color("text          ", "white")} ${preview(entry.content, 140)}`;
		case "tool_call": {
			const name = typeof entry.name === "string" ? entry.name : "?";
			let inputStr = "";
			try {
				inputStr = JSON.stringify(entry.input);
			} catch {
				inputStr = "<unserializable>";
			}
			return `${color("tool_call     ", "cyan")} ${color(name, "bold")} ${color(preview(inputStr, 160), "dim")}`;
		}
		case "tool_result": {
			const isError = entry.isError === true;
			const tag = isError
				? color("tool_result ✗ ", "red")
				: color("tool_result ✓ ", "green");
			const max = isError ? 400 : 140;
			const body = preview(entry.content, max);
			return `${tag} ${isError ? color(body, "red") : color(body, "dim")}`;
		}
		case "result": {
			const isError = entry.isError === true;
			const inTok = typeof entry.inputTokens === "number" ? entry.inputTokens : 0;
			const outTok = typeof entry.outputTokens === "number" ? entry.outputTokens : 0;
			const cost =
				typeof entry.costUsd === "number" && entry.costUsd > 0
					? ` cost=$${entry.costUsd.toFixed(4)}`
					: "";
			const status = isError ? color("✗", "red") : color("✓", "green");
			return `${color("result        ", "magenta")} ${status} ${color(`in=${inTok} out=${outTok}${cost}`, "dim")}`;
		}
		case "stdout":
			return `${color("stdout        ", "yellow")} ${color(preview(entry.content, 200), "dim")}`;
		case "system":
			return `${color("system        ", "blue")} ${preview(entry.content, 160)}`;
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
