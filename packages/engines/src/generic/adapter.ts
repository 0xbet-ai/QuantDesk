import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
	BacktestConfig,
	BacktestResult,
	DataConfig,
	DataRef,
	EngineAdapter,
	NormalizedResult,
	PaperConfig,
	PaperHandle,
	PaperStatus,
} from "../types.js";

const execAsync = promisify(exec);

/**
 * Generic engine: fallback for venues with no managed engine (e.g. Kalshi).
 *
 * Unlike Freqtrade and Nautilus, generic runs agent-authored scripts
 * directly on the host — no Docker container. This is the explicit
 * opt-out from isolation (CLAUDE.md rule 11). Users pick it by selecting
 * a venue whose only supported engine is `generic`.
 *
 * Generic supports BACKTEST ONLY. Paper trading throws.
 */
export class GenericAdapter implements EngineAdapter {
	readonly name = "generic";

	async ensureImage(): Promise<void> {
		// No image — host-native execution.
	}

	async downloadData(_config: DataConfig): Promise<DataRef> {
		// Generic desks have no managed downloader. The agent writes and
		// runs its own fetcher (see mode-generic prompt). Throwing here
		// makes the data_fetch MCP tool surface a clear error.
		throw new Error(
			"generic engine has no server-side downloader. Fetch data yourself and call register_dataset.",
		);
	}

	async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
		const { stdout } = await execAsync(
			`node ${config.strategyPath} 2>/dev/null || python3 ${config.strategyPath} 2>/dev/null || bun ${config.strategyPath}`,
			{ cwd: config.workspacePath },
		);

		const normalized = this.parseResult(stdout);
		return { raw: stdout, normalized };
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

	parseResult(raw: string): NormalizedResult {
		let data: NormalizedResult;
		try {
			data = JSON.parse(raw);
		} catch {
			throw new Error("Failed to parse generic result: script must output JSON to stdout");
		}

		if (typeof data.returnPct !== "number" || typeof data.totalTrades !== "number") {
			throw new Error("Failed to parse generic result: must include returnPct and totalTrades");
		}

		return {
			returnPct: data.returnPct,
			drawdownPct: data.drawdownPct ?? 0,
			winRate: data.winRate ?? 0,
			totalTrades: data.totalTrades,
			trades: data.trades ?? [],
		};
	}

	workspaceTemplate(): Record<string, string> {
		return {
			"README.md": `# QuantDesk generic workspace

Agent-written strategy. No engine template — the agent writes both
the strategy and the backtest/paper trading scripts from scratch.
`,
		};
	}
}
