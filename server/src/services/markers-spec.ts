/**
 * Phase 03 — parser for the function-signature blocks in
 * `doc/agent/MARKERS.md`. The blocks have a fixed format (defined by phase
 * 01's MARKERS.md rewrite), so this is a tiny custom parser rather than a
 * full markdown AST. Used by `markers-spec.test.ts` to enforce that every
 * marker in the spec is wired in code, and that every branch has a
 * corresponding `user_next_action`.
 *
 * Format expected (one fenced code block per marker):
 *
 *     RUN_BACKTEST(config: { ... })
 *       category:  Action
 *       form:      [RUN_BACKTEST]\n{...json...}\n[/RUN_BACKTEST]
 *       requires:  desk has ≥1 desk_datasets link
 *       effect:    ...
 *       postcond:  ...
 *       branches:
 *                  - success            → retrigger handles next turn
 *                  - engine_failure     → user must reply to retry
 *       user_next_action (per rule #12):
 *                  success         → none — retrigger continues automatically
 *                  engine_failure  → ...
 *
 * `branches` and `user_next_action` may also appear as a single inline line
 * in the form `branches: - a / - b / - c`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ParsedMarker {
	name: string;
	category: "Action" | "Proposal" | "Unknown";
	branches: string[];
	userNextActions: Record<string, string>;
}

// __dirname is server/src/services — repo root is three levels up.
const REPO_ROOT = join(__dirname, "..", "..", "..");
export const MARKERS_MD_PATH = join(REPO_ROOT, "doc", "agent", "MARKERS.md");

export function loadMarkersSpec(): ParsedMarker[] {
	const text = readFileSync(MARKERS_MD_PATH, "utf8");
	return parseMarkersSpec(text);
}

export function parseMarkersSpec(markdown: string): ParsedMarker[] {
	const blocks = extractFencedBlocks(markdown);
	const out: ParsedMarker[] = [];
	for (const block of blocks) {
		const parsed = parseSingleBlock(block);
		if (parsed) out.push(parsed);
	}
	return out;
}

function extractFencedBlocks(markdown: string): string[] {
	const lines = markdown.split("\n");
	const blocks: string[] = [];
	let inFence = false;
	let buffer: string[] = [];
	for (const line of lines) {
		if (line.trim() === "```") {
			if (inFence) {
				blocks.push(buffer.join("\n"));
				buffer = [];
				inFence = false;
			} else {
				inFence = true;
			}
			continue;
		}
		if (inFence) buffer.push(line);
	}
	return blocks;
}

function parseSingleBlock(block: string): ParsedMarker | null {
	const lines = block.split("\n");
	let nameLine = "";
	let nameLineIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.trim() === "") continue;
		nameLine = line;
		nameLineIdx = i;
		break;
	}
	const nameMatch = nameLine.match(/^([A-Z_][A-Z0-9_]*)\s*\(/);
	if (!nameMatch?.[1]) return null;
	const name = nameMatch[1];

	// Walk fields after the signature line. The signature may span multiple
	// lines if the parameter object is multi-line — find the first line that
	// looks like `\s+key:` to anchor the field section.
	let fieldStart = nameLineIdx + 1;
	while (
		fieldStart < lines.length &&
		!/^\s+\w+(?:\s*\([^)]*\))?\s*:/.test(lines[fieldStart] ?? "")
	) {
		fieldStart++;
	}

	const fields = parseFields(lines.slice(fieldStart));

	const categoryRaw = (fields.category ?? "").trim();
	const category: ParsedMarker["category"] =
		categoryRaw === "Action" || categoryRaw === "Proposal" ? categoryRaw : "Unknown";

	const branches = parseBranchList(fields.branches ?? "");
	const userNextActions = parseUserNextActions(fields.user_next_action ?? "");

	return { name, category, branches, userNextActions };
}

function parseFields(lines: string[]): Record<string, string> {
	const fields: Record<string, string> = {};
	let currentKey: string | null = null;
	let currentValue: string[] = [];
	let currentIndent = 0;

	const flush = () => {
		if (currentKey !== null) {
			fields[currentKey] = currentValue.join("\n").trim();
		}
	};

	for (const line of lines) {
		const fieldMatch = line.match(/^(\s+)(\w+)(?:\s*\([^)]*\))?\s*:\s*(.*)$/);
		if (fieldMatch) {
			const [, indent, key, rest] = fieldMatch;
			const indentLen = (indent ?? "").length;
			// A new field is recognised when its indent is the same as the
			// first field we saw (the canonical "field column"). Continuation
			// lines are deeper-indented and belong to the previous field.
			if (currentKey === null || indentLen <= currentIndent) {
				flush();
				currentKey = key ?? null;
				currentValue = [rest ?? ""];
				currentIndent = indentLen;
				continue;
			}
		}
		if (currentKey !== null) {
			currentValue.push(line);
		}
	}
	flush();
	return fields;
}

function parseBranchList(value: string): string[] {
	if (!value.trim()) return [];
	const out: string[] = [];
	// Inline form: `- a / - b / - c`
	if (value.includes("/") && !value.includes("\n")) {
		for (const part of value.split("/")) {
			const trimmed = part.trim().replace(/^-\s*/, "");
			if (trimmed) out.push(trimmed.split(/\s+/)[0] ?? "");
		}
		return out.filter((s) => s.length > 0);
	}
	// Multi-line form: `- name → description`
	for (const rawLine of value.split("\n")) {
		const line = rawLine.trim();
		if (!line.startsWith("-")) continue;
		const stripped = line.replace(/^-\s*/, "");
		// Branch name is everything up to → or whitespace, whichever comes first.
		const arrowIdx = stripped.indexOf("→");
		const namePart = arrowIdx >= 0 ? stripped.slice(0, arrowIdx) : stripped;
		const branchName = namePart.trim().split(/\s+/)[0] ?? "";
		if (branchName) out.push(branchName);
	}
	return out;
}

function parseUserNextActions(value: string): Record<string, string> {
	if (!value.trim()) return {};
	// Single-line value (e.g. EXPERIMENT_TITLE: "none — metadata-only ...")
	if (!value.includes("\n") && !value.includes("→")) {
		return { _: value.trim() };
	}
	const out: Record<string, string> = {};
	for (const rawLine of value.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const arrowIdx = line.indexOf("→");
		if (arrowIdx < 0) continue;
		const branch = line.slice(0, arrowIdx).trim().split(/\s+/)[0] ?? "";
		const desc = line.slice(arrowIdx + 1).trim();
		if (branch) out[branch] = desc;
	}
	return out;
}
