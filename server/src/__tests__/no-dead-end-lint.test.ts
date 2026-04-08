/**
 * CLAUDE.md rule #12 — no user dead-ends.
 *
 * This file is the phase 01 static lint: it walks every TypeScript source
 * file in `server/src` and enforces two rules:
 *
 * 1. **No direct `createComment({ author: "system", ... })`.** Outside of
 *    `server/src/services/comments.ts` (which defines the wrapper), every
 *    system-authored comment must go through `systemComment(...)` so the
 *    caller is forced to declare how rule #12 is satisfied.
 *
 * 2. **`systemComment({ nextAction: "action", content: <literal> })` must
 *    contain an action phrase.** Dynamic content with `nextAction: "action"`
 *    is rejected — authors must inline the action phrase so the lint can
 *    statically verify it.
 *
 * The lint is intentionally simple (regex + brace balancing) rather than
 * ts-morph / AST. The format is constrained enough that this is robust:
 * every violation surfaces as a test failure with file:line context.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_PHRASE_PATTERNS } from "../services/comments.js";

const SERVER_SRC = join(__dirname, "..");
const WRAPPER_FILE = join(SERVER_SRC, "services", "comments.ts");

/** Recursively collect `.ts` files under `dir`, skipping `__tests__` and `node_modules`. */
function walkTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === "__tests__") continue;
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			out.push(...walkTsFiles(full));
		} else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
			out.push(full);
		}
	}
	return out;
}

interface CallMatch {
	file: string;
	line: number;
	block: string;
}

/**
 * Find every call to `fnName({ ... })` in `source` and return the inner object
 * text (between the matched braces). Uses simple brace balancing and ignores
 * braces inside quoted strings and template literals.
 */
function findObjectCalls(source: string, fnName: string): CallMatch[] {
	const out: CallMatch[] = [];
	const pattern = new RegExp(`\\b${fnName}\\s*\\(\\s*\\{`, "g");
	let match = pattern.exec(source);
	while (match !== null) {
		const start = match.index + match[0].length - 1; // position of the `{`
		let depth = 0;
		let i = start;
		let inSingle = false;
		let inDouble = false;
		let inBacktick = false;
		for (; i < source.length; i++) {
			const ch = source[i]!;
			const prev = source[i - 1];
			if (inSingle) {
				if (ch === "'" && prev !== "\\") inSingle = false;
				continue;
			}
			if (inDouble) {
				if (ch === '"' && prev !== "\\") inDouble = false;
				continue;
			}
			if (inBacktick) {
				if (ch === "`" && prev !== "\\") inBacktick = false;
				continue;
			}
			if (ch === "'") {
				inSingle = true;
				continue;
			}
			if (ch === '"') {
				inDouble = true;
				continue;
			}
			if (ch === "`") {
				inBacktick = true;
				continue;
			}
			if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) break;
			}
		}
		const block = source.slice(start + 1, i);
		const line = source.slice(0, match.index).split("\n").length;
		out.push({ file: "", line, block });
		match = pattern.exec(source);
	}
	return out;
}

/**
 * Find the index of a top-level object key (e.g. `content:`) inside a call
 * block. "Top-level" means at brace-depth 0 relative to the block — the block
 * itself already has its outer `{}` stripped by `findObjectCalls`.
 */
function findTopLevelKey(block: string, key: string): number {
	const needle = new RegExp(`\\b${key}\\s*:`);
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	let inBacktick = false;
	for (let i = 0; i < block.length; i++) {
		const ch = block[i]!;
		const prev = block[i - 1];
		if (inSingle) {
			if (ch === "'" && prev !== "\\") inSingle = false;
			continue;
		}
		if (inDouble) {
			if (ch === '"' && prev !== "\\") inDouble = false;
			continue;
		}
		if (inBacktick) {
			if (ch === "`" && prev !== "\\") inBacktick = false;
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			continue;
		}
		if (ch === "`") {
			inBacktick = true;
			continue;
		}
		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth--;
		else if (depth === 0) {
			const slice = block.slice(i);
			const m = slice.match(needle);
			if (m && m.index === 0) return i;
		}
	}
	return -1;
}

/**
 * Extract the expression that follows a top-level key, stopping at the next
 * top-level `,` or end of block. Returns the raw expression text (trimmed).
 */
function extractValueExpr(block: string, key: string): string | null {
	const keyIdx = findTopLevelKey(block, key);
	if (keyIdx === -1) return null;
	// skip past "key"
	let i = keyIdx + key.length;
	// skip whitespace + ":"
	while (i < block.length && /\s/.test(block[i]!)) i++;
	if (block[i] !== ":") return null;
	i++;
	while (i < block.length && /\s/.test(block[i]!)) i++;
	const start = i;
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	let inBacktick = false;
	for (; i < block.length; i++) {
		const ch = block[i]!;
		const prev = block[i - 1];
		if (inSingle) {
			if (ch === "'" && prev !== "\\") inSingle = false;
			continue;
		}
		if (inDouble) {
			if (ch === '"' && prev !== "\\") inDouble = false;
			continue;
		}
		if (inBacktick) {
			if (ch === "`" && prev !== "\\") inBacktick = false;
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			continue;
		}
		if (ch === "`") {
			inBacktick = true;
			continue;
		}
		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth--;
		else if (ch === "," && depth === 0) break;
	}
	return block.slice(start, i).trim();
}

/**
 * Parse a string expression as a concatenation of string literals (possibly
 * split with `+`). Returns the assembled content, or null if any part is
 * dynamic (variable, function call, or interpolated template).
 */
function parseLiteralConcatenation(expr: string): string | null {
	const parts: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	let inBacktick = false;
	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i]!;
		const prev = expr[i - 1];
		if (inSingle) {
			current += ch;
			if (ch === "'" && prev !== "\\") inSingle = false;
			continue;
		}
		if (inDouble) {
			current += ch;
			if (ch === '"' && prev !== "\\") inDouble = false;
			continue;
		}
		if (inBacktick) {
			current += ch;
			if (ch === "`" && prev !== "\\") inBacktick = false;
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			current += ch;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			current += ch;
			continue;
		}
		if (ch === "`") {
			inBacktick = true;
			current += ch;
			continue;
		}
		if (ch === "+") {
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	if (current.trim()) parts.push(current.trim());

	let assembled = "";
	for (const part of parts) {
		if (part.startsWith('"') && part.endsWith('"')) {
			assembled += part.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
		} else if (part.startsWith("'") && part.endsWith("'")) {
			assembled += part.slice(1, -1).replace(/\\'/g, "'").replace(/\\n/g, "\n");
		} else if (part.startsWith("`") && part.endsWith("`")) {
			// Template literal — replace `${...}` interpolations with a placeholder
			// so the surrounding literal text is still searchable for action phrases.
			// Dynamic parts cannot introduce phrases, so this is lint-safe.
			const inner = part.slice(1, -1);
			const stripped = inner.replace(/\$\{[^}]*\}/g, "<VAR>");
			assembled += stripped;
		} else {
			return null; // variable or expression
		}
	}
	return assembled;
}

function extractLiteralContent(block: string): string | null {
	const expr = extractValueExpr(block, "content");
	if (expr === null) return null;
	return parseLiteralConcatenation(expr);
}

function extractNextAction(block: string): string | null {
	const m = block.match(/nextAction\s*:\s*"([a-z]+)"/);
	return m?.[1] ?? null;
}

describe("rule #12 — no user dead-ends (static lint)", () => {
	const files = walkTsFiles(SERVER_SRC);

	it("there is at least one .ts file scanned (sanity)", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no direct createComment({ author: "system" }) outside the wrapper', () => {
		const violations: string[] = [];
		for (const file of files) {
			if (file === WRAPPER_FILE) continue;
			const src = readFileSync(file, "utf8");
			const calls = findObjectCalls(src, "createComment");
			for (const call of calls) {
				if (/author\s*:\s*["']system["']/.test(call.block)) {
					violations.push(`${relative(SERVER_SRC, file)}:${call.line}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it('every systemComment({ nextAction: "action" }) has a literal content with an action phrase', () => {
		const violations: string[] = [];
		for (const file of files) {
			if (file === WRAPPER_FILE) continue;
			const src = readFileSync(file, "utf8");
			const calls = findObjectCalls(src, "systemComment");
			for (const call of calls) {
				const next = extractNextAction(call.block);
				if (next !== "action") continue;
				const content = extractLiteralContent(call.block);
				if (content === null) {
					violations.push(
						`${relative(SERVER_SRC, file)}:${call.line} — nextAction: "action" requires a literal content so the lint can verify the action phrase`,
					);
					continue;
				}
				const hasPhrase = ACTION_PHRASE_PATTERNS.some((re) => re.test(content));
				if (!hasPhrase) {
					violations.push(
						`${relative(SERVER_SRC, file)}:${call.line} — content does not contain an action phrase from ACTION_PHRASE_PATTERNS. Content: ${JSON.stringify(content.slice(0, 120))}`,
					);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("ACTION_PHRASE_PATTERNS itself matches a known-good example", () => {
		const good = "You may now write the strategy and emit [RUN_BACKTEST].";
		expect(ACTION_PHRASE_PATTERNS.some((re) => re.test(good))).toBe(true);
	});

	it("ACTION_PHRASE_PATTERNS rejects a known-bad example", () => {
		const bad = "Backtest complete.";
		expect(ACTION_PHRASE_PATTERNS.some((re) => re.test(bad))).toBe(false);
	});
});
