import fs from "node:fs";
import path from "node:path";
import type { AgentAdapter, SpawnResult, StreamChunk } from "../types.js";
import { ACTIVE_SCENARIO } from "./active-scenario.js";

// Walk up from cwd looking for `fixtures/mock-agent`. Server may be launched
// from `server/` (via `pnpm dev`) rather than the repo root, so a naive
// `process.cwd() + fixtures/mock-agent` resolves to the wrong place.
function resolveFixtureDir(): string {
	if (process.env.MOCK_FIXTURE_DIR) return process.env.MOCK_FIXTURE_DIR;
	let dir = process.cwd();
	for (let i = 0; i < 8; i++) {
		const candidate = path.join(dir, "fixtures", "mock-agent");
		// Check for happy.py specifically — docker `-v` auto-creates empty
		// source dirs when a previous mount used a wrong path, which would
		// otherwise cause this walk-up to hit a phantom empty directory.
		if (fs.existsSync(path.join(candidate, "happy.py"))) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		"MockAdapter: could not locate fixtures/mock-agent — set MOCK_FIXTURE_DIR explicitly",
	);
}

// Mock adapter for UI lifecycle debugging.
// Spawns a docker container that runs a deterministic python scenario from
// `fixtures/mock-agent/`. Each scenario emits plain text lines on a controlled
// schedule so the rest of the agent pipeline (turn rows, comments, status
// transitions, WS push, TurnCard rendering) can be exercised without depending
// on the real Claude/Codex CLI.
//
// Activate by setting `MOCK_AGENT=1` in the server env. Pick scenario via
// `MOCK_SCENARIO=<file.py>` (default `happy.py`). Override fixture dir with
// `MOCK_FIXTURE_DIR` and image with `MOCK_IMAGE` if needed.
const DEFAULT_IMAGE = "python:3.11-slim";

// Stable fake session id — we reuse the same id for every mock turn on
// the same desk so the agent-trigger persists it once (via the init
// chunk below) and then every subsequent turn passes `--resume` and the
// prompt builder uses its `isResume` branch. Without this the prompt
// filters out system comments (the non-resume branch drops them) and
// the dispatcher's "dataset already registered" sniff cannot see the
// `(mock) Downloaded …` comment, so DATA_FETCH retriggers forever.
const MOCK_SESSION_ID = "mock-session-fixed";

export class MockAdapter implements AgentAdapter {
	readonly name = "mock";

	buildSpawnArgs(_prompt: string, _sessionId?: string): string[] {
		const scenario = process.env.MOCK_SCENARIO ?? ACTIVE_SCENARIO;
		const fixtureDir = resolveFixtureDir();
		const image = process.env.MOCK_IMAGE ?? DEFAULT_IMAGE;
		console.error(
			`[mock-agent] cwd=${process.cwd()} fixtureDir=${fixtureDir} scenario=${scenario}`,
		);
		return [
			"docker",
			"run",
			"--rm",
			"-i",
			"--label",
			"quantdesk.mock-agent=1",
			"-v",
			`${fixtureDir}:/scenarios:ro`,
			image,
			"python",
			"-u",
			`/scenarios/${scenario}`,
		];
	}

	parseStreamLine(line: string): StreamChunk | null {
		const trimmed = line.replace(/\r$/, "");
		if (trimmed.length === 0) return null;
		// Use `stdout` (not `text`) so the UI's RunTranscriptView appends each
		// line instead of replacing. The `text` channel is reserved for
		// Claude-style accumulated message text where each chunk is the full
		// message-so-far; mock scenarios emit discrete lines so we want
		// append semantics.
		return { type: "stdout", content: trimmed };
	}

	parseOutputStream(lines: string[]): SpawnResult {
		const text = lines
			.map((l) => l.replace(/\r$/, ""))
			.filter((l) => l.length > 0)
			.join("\n");
		return {
			sessionId: MOCK_SESSION_ID,
			resultText: text,
			usage: { inputTokens: 0, outputTokens: 0 },
		};
	}
}
