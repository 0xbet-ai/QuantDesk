import crypto from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { DockerError, hasImage, quantdeskLabels, runContainer } from "../docker.js";
import { ENGINE_IMAGES } from "../images.js";
import { formatMemory, getEngineRuntimeConfig, resolveImage } from "../runtime-config.js";
import {
	deriveMetrics,
	type BacktestConfig,
	type BacktestResult,
	type DataConfig,
	type DataRef,
	type EngineAdapter,
	type NormalizedResult,
	type PaperConfig,
	type PaperHandle,
	type PaperStatus,
	type TradeEntry,
} from "../types.js";

/**
 * Script extension → runtime name understood by the generic entrypoint
 * script baked into `docker/generic/Dockerfile`. The entrypoint handles
 * per-runtime dependency install and execution.
 */
const RUNTIME_BY_EXT: Record<string, "python" | "node" | "bun" | "rust" | "go"> = {
	".py": "python",
	".js": "node",
	".mjs": "node",
	".cjs": "node",
	".ts": "bun",
	".rs": "rust",
	".go": "go",
};

/**
 * Thrown when `quantdesk/generic:<tag>` is not present locally and we
 * cannot pull it yet (the image currently ships as a build-from-source
 * Dockerfile). Surfaced to the user with an actionable next step.
 */
export class GenericImageMissingError extends Error {
	readonly image: string;
	constructor(image: string) {
		super(
			`Generic engine image \`${image}\` is not installed on Docker. ` +
				`Build it once with \`pnpm build:generic-image\` (or ` +
				`\`docker build -t ${image} docker/generic/\` from the repo root), ` +
				`then retry.`,
		);
		this.name = "GenericImageMissingError";
		this.image = image;
	}
}

export class UnsupportedRuntimeError extends Error {
	constructor(ext: string) {
		super(
			`generic engine: unsupported script extension \`${ext || "(none)"}\`. ` +
				`Supported: ${Object.keys(RUNTIME_BY_EXT).join(", ")}.`,
		);
		this.name = "UnsupportedRuntimeError";
	}
}

/**
 * Mount the host-side package-manager caches into the container so
 * `pip install`, `npm install`, `cargo fetch`, and `go mod download`
 * are fast on subsequent runs. First run still eats the cost.
 */
function cacheVolumes(): string[] {
	const root = join(homedir(), ".quantdesk", "generic-cache");
	const dirs = {
		pip: join(root, "pip"),
		npm: join(root, "npm"),
		cargo: join(root, "cargo"),
		go: join(root, "go-build"),
		gomod: join(root, "gopath"),
	};
	for (const d of Object.values(dirs)) {
		if (!existsSync(d)) mkdirSync(d, { recursive: true });
	}
	return [
		`${dirs.pip}:/root/.cache/pip`,
		`${dirs.npm}:/root/.npm`,
		`${dirs.cargo}:/root/.cargo`,
		`${dirs.go}:/root/.cache/go-build`,
		`${dirs.gomod}:/root/go`,
	];
}

/**
 * Generic engine: runs agent-authored scripts inside a single Ubuntu-
 * based container (`quantdesk/generic`) that bundles python3, node,
 * bun, rust, and go. This is the OS-neutral alternative to host-native
 * exec — the only requirement on the user's machine is Docker.
 *
 * Paper trading is not yet implemented for generic desks.
 */
export class GenericAdapter implements EngineAdapter {
	readonly name = "generic";

	private get image(): string {
		return resolveImage("generic", ENGINE_IMAGES.generic);
	}

	async ensureImage(): Promise<void> {
		if (!(await hasImage(this.image))) {
			throw new GenericImageMissingError(this.image);
		}
	}

	async downloadData(_config: DataConfig): Promise<DataRef> {
		// The agent owns data acquisition on generic desks: it writes a
		// fetcher script (ccxt / venue SDK / The Graph / …), runs it via
		// its own Bash tool, and then calls `register_dataset`. The
		// server has no generic downloader to invoke, so this method
		// deliberately fails fast.
		throw new Error(
			"generic engine has no server-side downloader. Fetch data yourself and call register_dataset.",
		);
	}

	/**
	 * Execute an arbitrary script inside the generic sandbox image and
	 * return its raw stdout / stderr / exit code. Used by the
	 * `run_script` MCP tool for agent-authored fetchers, setup steps,
	 * or anything else that is NOT the final strategy evaluation.
	 *
	 * Unlike `runBacktest`, the caller does not expect the stdout to
	 * match `NormalizedResult`, so no parsing or throwing happens on a
	 * non-JSON tail line.
	 */
	async runScript(input: {
		workspacePath: string;
		scriptPath: string;
		extraVolumes?: string[];
		onLogLine?: (line: string, stream: "stdout" | "stderr") => void;
	}): Promise<{ stdout: string; stderr: string; exitCode: number; containerName: string }> {
		await this.ensureImage();
		const ext = extname(input.scriptPath).toLowerCase();
		const runtime = RUNTIME_BY_EXT[ext];
		if (!runtime) {
			throw new UnsupportedRuntimeError(ext);
		}
		const workspaceAbs = resolve(input.workspacePath);
		const scriptId = crypto.randomUUID().slice(0, 8);
		const containerName = `quantdesk-script-${scriptId}`;
		const rc = getEngineRuntimeConfig();
		const result = await runContainer(
			{
				image: this.image,
				name: containerName,
				rm: true,
				cpus: rc.generic.cpus,
				memory: formatMemory(rc.generic.memoryGb),
				labels: quantdeskLabels({
					runId: scriptId,
					engine: "generic",
					kind: "script",
				}),
				volumes: [`${workspaceAbs}:/workspace`, ...cacheVolumes(), ...(input.extraVolumes ?? [])],
				// Force Python (and Node) to flush stdout on every write so
				// the heartbeat proxy in the MCP handler fires mid-run, not
				// just at process exit. Without this, a 5-minute data fetch
				// or analysis script triggers a false heartbeat timeout.
				env: { PYTHONUNBUFFERED: "1", NODE_OPTIONS: "--max-old-space-size=1536" },
				command: [runtime, input.scriptPath],
			},
			{
				onStdoutLine: input.onLogLine ? (line) => input.onLogLine!(line, "stdout") : undefined,
				onStderrLine: input.onLogLine ? (line) => input.onLogLine!(line, "stderr") : undefined,
			},
		);
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
			containerName,
		};
	}

	async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
		await this.ensureImage();
		if (!config.strategyPath) {
			// The generic adapter has no framework contract and no seeded
			// entrypoint — the agent MUST have written a script and passed
			// its path. Silently defaulting would run nothing.
			throw new Error(
				"generic.runBacktest: `strategyPath` is required — the agent must pass the script path (e.g. `fetch_data.py`).",
			);
		}
		const ext = extname(config.strategyPath).toLowerCase();
		const runtime = RUNTIME_BY_EXT[ext];
		if (!runtime) {
			throw new UnsupportedRuntimeError(ext);
		}

		const workspaceAbs = resolve(config.workspacePath);
		const externalMountVolumes = config.extraVolumes ?? [];
		const containerName = `quantdesk-backtest-${config.runId.slice(0, 8)}`;
		const rc = getEngineRuntimeConfig();

		const result = await runContainer(
			{
				image: this.image,
				name: containerName,
				rm: true,
				cpus: rc.generic.cpus,
				memory: formatMemory(rc.generic.memoryGb),
				volumes: [`${workspaceAbs}:/workspace`, ...cacheVolumes(), ...externalMountVolumes],
				env: { PYTHONUNBUFFERED: "1" },
				command: [runtime, config.strategyPath],
			},
			{
				onStdoutLine: config.onLogLine ? (line) => config.onLogLine!(line, "stdout") : undefined,
				onStderrLine: config.onLogLine ? (line) => config.onLogLine!(line, "stderr") : undefined,
			},
		);

		if (result.exitCode !== 0) {
			throw new DockerError(
				`generic ${runtime} script exited ${result.exitCode}: ` +
					`${(result.stderr || result.stdout).trim().split("\n").slice(-10).join("\n")}`,
				result.exitCode,
				result.stderr,
			);
		}

		// Agent scripts must print the NormalizedResult JSON as the LAST
		// line of stdout. Pick the final non-empty line so entrypoint /
		// framework banners above don't poison the parser.
		const lines = result.stdout
			.trim()
			.split("\n")
			.filter((l) => l.trim().length > 0);
		const lastLine = lines[lines.length - 1] ?? "";
		const normalized = this.parseResult(lastLine, config.wallet);
		return { raw: result.stdout, normalized };
	}

	async startPaper(_config: PaperConfig): Promise<PaperHandle> {
		throw new Error("generic engine does not support paper trading");
	}

	async stopPaper(_handle: PaperHandle): Promise<void> {
		throw new Error("generic engine does not support paper trading");
	}

	async getPaperStatus(_handle: PaperHandle): Promise<PaperStatus> {
		throw new Error("generic engine does not support paper trading");
	}

	parseResult(raw: string, wallet = 10_000): NormalizedResult {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(raw);
		} catch {
			throw new Error("Failed to parse generic result: script must output JSON to stdout");
		}

		// If the script provided trades, derive all metrics uniformly.
		// If not, fall back to reading pre-computed metrics from the JSON
		// (backwards compat with scripts that already compute them).
		const trades: TradeEntry[] = Array.isArray(data.trades)
			? (data.trades as TradeEntry[])
			: [];

		if (trades.length > 0) {
			return deriveMetrics(trades, wallet);
		}

		// Fallback: script provided metrics directly (no trades array)
		if (typeof data.returnPct !== "number" || typeof data.totalTrades !== "number") {
			throw new Error(
				"Failed to parse generic result: must include either a `trades` array or `returnPct` + `totalTrades`",
			);
		}
		return {
			returnPct: data.returnPct as number,
			drawdownPct: (data.drawdownPct as number) ?? 0,
			winRate: (data.winRate as number) ?? 0,
			totalTrades: data.totalTrades as number,
			trades: [],
		};
	}

	workspaceTemplate(_opts: { venue: string }): Record<string, string> {
		return {
			"README.md": `# QuantDesk generic workspace

Agent-written strategy. No engine template — the agent writes both
the strategy and the backtest/paper trading scripts from scratch.

Scripts run inside a single sandbox container
(\`quantdesk/generic:<pinned>\`) that bundles python3, node, bun,
rust, and go. Per-language dependencies are declared in the usual
manifest file at the workspace root:

  - python  → requirements.txt
  - node    → package.json
  - bun     → package.json
  - rust    → Cargo.toml (standard layout, src/main.rs)
  - go      → go.mod

The container entrypoint installs dependencies from the manifest
before running the script. Cache volumes are mounted on the host so
repeat runs are fast.

The last line of stdout MUST be a NormalizedResult JSON object.
`,
			// Keep engine outputs, caches, and dependency folders out of git.
			// The generic engine doesn't dictate output paths, so this is a
			// conservative list covering common defaults across Python / Node /
			// Rust / Go. The agent can extend this file if a script uses a
			// non-standard output dir.
			".gitignore": [
				"# engine outputs (common defaults)",
				"backtest_results/",
				"results/",
				"output/",
				"logs/",
				"",
				"# market data cache (datasets are global, not per-desk)",
				"data/",
				"",
				"# python",
				"__pycache__/",
				"*.pyc",
				".venv/",
				"venv/",
				"",
				"# node / bun",
				"node_modules/",
				"",
				"# rust",
				"target/",
				"",
				"# go",
				"bin/",
				"",
			].join("\n"),
		};
	}
}
