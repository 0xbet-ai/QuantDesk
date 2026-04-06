import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Persist agent streaming chunks as JSONL files.
 * One file per experiment: agent-logs/{experimentId}.jsonl
 * Each line is a timestamped StreamChunk from the adapter.
 */

export type AgentLogEntry = { ts: string } & Record<string, unknown>;

const LOGS_DIR = join(process.cwd(), "agent-logs");

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
