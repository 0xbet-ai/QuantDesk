import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
	BacktestConfig,
	BacktestResult,
	DataConfig,
	DataRef,
	EngineAdapter,
	LiveConfig,
	LiveHandle,
	LiveStatus,
	NormalizedResult,
} from "../types.js";

const execAsync = promisify(exec);

export class GenericAdapter implements EngineAdapter {
	readonly name = "generic";

	async ensureInstalled(): Promise<void> {
		// Generic adapter only needs node/python/bun — assumed available
	}

	async downloadData(config: DataConfig): Promise<DataRef> {
		const scriptPath = `${config.workspacePath}/download-data.sh`;
		try {
			await execAsync(`bash ${scriptPath}`, { cwd: config.workspacePath });
		} catch {
			// Script might not exist yet — agent writes it
		}
		return { datasetId: crypto.randomUUID(), path: `${config.workspacePath}/data` };
	}

	async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
		const { stdout } = await execAsync(
			`node ${config.strategyPath} 2>/dev/null || python3 ${config.strategyPath} 2>/dev/null || bun ${config.strategyPath}`,
			{ cwd: config.workspacePath },
		);

		const normalized = this.parseResult(stdout);
		return { raw: stdout, normalized };
	}

	async startLive(config: LiveConfig): Promise<LiveHandle> {
		const { stdout } = await execAsync(`node ${config.strategyPath} --live &`, {
			cwd: config.workspacePath,
		});
		return { processId: stdout.trim(), runId: crypto.randomUUID() };
	}

	async stopLive(handle: LiveHandle): Promise<void> {
		try {
			await execAsync(`kill ${handle.processId}`);
		} catch {
			// Process might already be dead
		}
	}

	async getLiveStatus(_handle: LiveHandle): Promise<LiveStatus> {
		return {
			running: false,
			unrealizedPnl: 0,
			realizedPnl: 0,
			openPositions: 0,
			uptime: 0,
		};
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
}
