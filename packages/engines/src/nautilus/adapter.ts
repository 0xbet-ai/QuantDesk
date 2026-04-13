import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	DockerError,
	ensureDockerAvailable,
	logsFrom,
	pullImage,
	quantdeskLabels,
	removeContainer,
	runContainer,
	runDetached,
	stopContainer,
} from "../docker.js";
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
 * Nautilus Trader adapter.
 *
 * Runs everything inside the official `nautilus_trader` Docker image.
 * Strategies are written by the agent as Python `Strategy` subclasses.
 *
 * Because Nautilus has no built-in REST API for status, we ship a small
 * `runner.py` alongside the strategy that:
 *   - Builds a TradingNode with the right data + exec clients
 *   - Subscribes to MessageBus events
 *   - Emits a JSONL stream to stdout, one event per line
 *
 * The server reads the container's stdout (via `docker logs`) to extract
 * run results and live paper trading status.
 */

const WORKSPACE_IN_CONTAINER = "/workspace";

interface NautilusBacktestEvent {
	type: "backtest_result";
	returnPct: number;
	drawdownPct: number;
	winRate: number;
	totalTrades: number;
	trades: NautilusTrade[];
}

interface NautilusTrade {
	pair: string;
	side: string;
	price: number;
	amount: number;
	pnl: number;
	openedAt: string;
	closedAt: string;
}

interface NautilusPaperSnapshot {
	type: "paper_status";
	unrealizedPnl: number;
	realizedPnl: number;
	openPositions: number;
	uptime: number;
}

// Legacy shape kept for the existing fixture test.
interface LegacyNautilusResult {
	total_return: number;
	max_drawdown: number;
	win_rate: number;
	total_trades: number;
	trades: Array<{
		instrument_id: string;
		side: string;
		avg_price: number;
		quantity: number;
		realized_pnl: number;
		ts_opened: string;
		ts_closed: string;
	}>;
}

export class NautilusAdapter implements EngineAdapter {
	readonly name = "nautilus";

	private get image(): string {
		return resolveImage("nautilus", ENGINE_IMAGES.nautilus);
	}

	async ensureImage(): Promise<void> {
		await ensureDockerAvailable();
		await pullImage(this.image);
	}

	async downloadData(_config: DataConfig): Promise<DataRef> {
		// Nautilus has no managed server-side downloader. The agent writes
		// its own fetcher script and runs it via run_script. Throwing here
		// lets the MCP data_fetch tool return a clear error.
		throw new Error(
			"nautilus engine has no server-side downloader. Fetch data yourself and call register_dataset.",
		);
	}

	async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
		const workspaceAbs = resolve(config.workspacePath);
		ensureRunnerPy(workspaceAbs);

		const runtime = getEngineRuntimeConfig();
		const result = await runContainer({
			image: this.image,
			rm: true,
			volumes: [`${workspaceAbs}:${WORKSPACE_IN_CONTAINER}`, ...(config.extraVolumes ?? [])],
			workdir: WORKSPACE_IN_CONTAINER,
			cpus: runtime.backtest.cpus,
			memory: formatMemory(runtime.backtest.memoryGb),
			command: ["python", "runner.py", "--mode", "backtest"],
		});

		if (result.exitCode !== 0) {
			throw new DockerError(
				`nautilus backtest failed: ${result.stderr.trim() || result.stdout.trim()}`,
				result.exitCode,
				result.stderr,
			);
		}

		// runner.py emits JSONL events on stdout. Find the terminal
		// `backtest_result` event and parse it.
		const event = extractLastEvent<NautilusBacktestEvent>(result.stdout, "backtest_result");
		if (!event) {
			throw new Error("nautilus backtest completed but no backtest_result event on stdout");
		}
		return {
			raw: result.stdout,
			normalized: this.parseResult(JSON.stringify(event), config.wallet),
		};
	}

	async startPaper(config: PaperConfig): Promise<PaperHandle> {
		await ensureDockerAvailable();
		const workspaceAbs = resolve(config.workspacePath);
		const containerName = `quantdesk-paper-${config.runId}`;
		ensureRunnerPy(workspaceAbs);

		// Write a small JSON config for the runner.
		writeFileSync(
			join(workspaceAbs, "runner.config.json"),
			JSON.stringify(
				{
					mode: "paper",
					wallet: config.wallet,
					exchange: config.exchange,
					pairs: config.pairs,
				},
				null,
				2,
			),
		);

		const runtime = getEngineRuntimeConfig();
		await runDetached({
			image: this.image,
			name: containerName,
			labels: quantdeskLabels({
				runId: config.runId,
				engine: "nautilus",
				kind: "paper",
			}),
			volumes: [`${workspaceAbs}:${WORKSPACE_IN_CONTAINER}`, ...(config.extraVolumes ?? [])],
			workdir: WORKSPACE_IN_CONTAINER,
			cpus: runtime.paper.cpus,
			memory: formatMemory(runtime.paper.memoryGb),
			command: ["python", "-u", "runner.py", "--mode", "paper"],
		});

		return {
			containerName,
			runId: config.runId,
			meta: { startedAt: Date.now() },
		};
	}

	async stopPaper(handle: PaperHandle): Promise<void> {
		await stopContainer(handle.containerName, getEngineRuntimeConfig().paperStopGracefulSec);
		await removeContainer(handle.containerName);
	}

	async getPaperStatus(handle: PaperHandle): Promise<PaperStatus> {
		try {
			const { stdout, exitCode } = await logsFrom(handle.containerName, { tail: 200 });
			if (exitCode !== 0) {
				return blankStatus(false);
			}
			const snapshot = extractLastEvent<NautilusPaperSnapshot>(stdout, "paper_status");
			if (!snapshot) {
				return blankStatus(true);
			}
			return {
				running: true,
				unrealizedPnl: snapshot.unrealizedPnl,
				realizedPnl: snapshot.realizedPnl,
				openPositions: snapshot.openPositions,
				uptime: snapshot.uptime,
			};
		} catch {
			return blankStatus(false);
		}
	}

	parseResult(raw: string, wallet = 10_000): NormalizedResult {
		let data: NautilusBacktestEvent | LegacyNautilusResult;
		try {
			data = JSON.parse(raw);
		} catch {
			throw new Error("Failed to parse nautilus result: invalid JSON");
		}

		// Extract trades from either the modern runner.py shape or the
		// legacy fixture shape. Metrics are NO LONGER read from the
		// engine output — they're derived uniformly from the trade list
		// by `deriveMetrics()` so drawdown/return/winRate are always
		// consistent regardless of what the agent's strategy.run()
		// returns (the Nautilus drawdown=0.00% bug was exactly this:
		// the agent forgot to compute drawdownPct and the old code
		// silently fell back to 0).
		let trades: TradeEntry[];
		const eventWallet = (data as unknown as Record<string, unknown>).wallet;
		const effectiveWallet =
			typeof eventWallet === "number" && eventWallet > 0 ? eventWallet : wallet;

		if ("trades" in data && Array.isArray(data.trades)) {
			const rawTrades = data.trades as NautilusTrade[];
			trades = rawTrades.map((t) => ({
				pair: t.pair ?? (t as unknown as { instrument_id?: string }).instrument_id?.split(".")[0] ?? "?",
				side: (t.side ?? "").toLowerCase() === "sell" ? ("sell" as const) : ("buy" as const),
				price: t.price ?? (t as unknown as { avg_price?: number }).avg_price ?? 0,
				amount: t.amount ?? (t as unknown as { quantity?: number }).quantity ?? 0,
				pnl: t.pnl ?? (t as unknown as { realized_pnl?: number }).realized_pnl ?? 0,
				openedAt: t.openedAt ?? (t as unknown as { ts_opened?: string }).ts_opened ?? "",
				closedAt: t.closedAt ?? (t as unknown as { ts_closed?: string }).ts_closed ?? "",
			}));
		} else {
			trades = [];
		}

		return deriveMetrics(trades, effectiveWallet);
	}

	workspaceTemplate(_opts: { venue: string }): Record<string, string> {
		return {
			"strategy.py": `# Nautilus Trader Strategy
class QuantDeskStrategy:
    """Strategy generated by QuantDesk agent."""
    pass
`,
			"config.py": `# Nautilus Trader configuration
from nautilus_trader.config import StrategyConfig

config = StrategyConfig(
    strategy_id="QuantDesk-001",
)
`,
			// Keep engine outputs and heavy caches out of git. Every run
			// commit should capture only reproducible *inputs* (strategy.py,
			// config.py, agent scripts), not engine-generated artifacts.
			".gitignore": [
				"# engine outputs",
				"backtest_results/",
				"logs/",
				"catalog/",
				"",
				"# market data cache (datasets are global, not per-desk)",
				"data/",
				"",
				"# python",
				"__pycache__/",
				"*.pyc",
				"",
			].join("\n"),
		};
	}
}

/**
 * Extract the last JSONL event of a given type from a stdout stream.
 * The runner.py we ship emits one JSON object per line; we scan backwards
 * for the most recent occurrence of the requested type.
 */
export function extractLastEvent<T extends { type: string }>(
	stdout: string,
	type: string,
): T | null {
	const lines = stdout.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim();
		if (!line || !line.startsWith("{")) continue;
		try {
			const parsed = JSON.parse(line) as T;
			if (parsed.type === type) return parsed;
		} catch {
			// not JSON — skip
		}
	}
	return null;
}

/**
 * Ensure a `runner.py` exists in the workspace. QuantDesk ships a default
 * runner that the agent can modify as needed.
 *
 * The runner is a small bridge: it loads the agent's Strategy subclass,
 * builds a TradingNode (backtest or SandboxExecutionClient for paper),
 * subscribes to MessageBus events, and emits JSONL to stdout.
 */
function ensureRunnerPy(workspaceAbs: string): void {
	const runnerPath = join(workspaceAbs, "runner.py");
	if (existsSync(runnerPath)) {
		// Agent already wrote a custom runner — respect it
		return;
	}
	writeFileSync(runnerPath, DEFAULT_RUNNER_PY);
}

/**
 * Minimal default runner. The agent is free to replace this with something
 * more elaborate. It must print JSONL events with `type` field so the
 * adapter can parse them.
 */
const DEFAULT_RUNNER_PY = `#!/usr/bin/env python3
"""QuantDesk Nautilus runner — loads the agent's Strategy and bridges
MessageBus events to stdout JSONL.

Emitted event types:
  - backtest_result  (once, at end of a backtest run)
  - paper_status     (periodically, while paper trading)
"""
import argparse
import json
import sys
import time
from pathlib import Path


def emit(event_type: str, **fields) -> None:
    payload = {"type": event_type, **fields}
    print(json.dumps(payload), flush=True)


def run_backtest() -> None:
    # Placeholder — the agent is expected to either replace runner.py with a
    # custom implementation, or import strategy.py and wire up BacktestEngine.
    try:
        from strategy import run  # type: ignore
    except Exception as err:
        emit("error", message=f"failed to import strategy.run: {err}")
        sys.exit(1)
    try:
        result = run()
    except Exception as err:
        emit("error", message=f"strategy.run() raised: {err}")
        sys.exit(1)
    emit(
        "backtest_result",
        returnPct=float(result.get("returnPct", 0.0)),
        drawdownPct=float(result.get("drawdownPct", 0.0)),
        winRate=float(result.get("winRate", 0.0)),
        totalTrades=int(result.get("totalTrades", 0)),
        trades=result.get("trades", []),
    )


def run_paper() -> None:
    # Placeholder paper loop. Replace with a real TradingNode +
    # SandboxExecutionClient setup once the strategy is ready.
    start = time.time()
    try:
        from strategy import paper_step  # type: ignore
    except Exception as err:
        emit("error", message=f"failed to import strategy.paper_step: {err}")
        sys.exit(1)
    while True:
        try:
            snap = paper_step()
        except Exception as err:
            emit("error", message=f"paper_step raised: {err}")
            time.sleep(5)
            continue
        emit(
            "paper_status",
            unrealizedPnl=float(snap.get("unrealizedPnl", 0.0)),
            realizedPnl=float(snap.get("realizedPnl", 0.0)),
            openPositions=int(snap.get("openPositions", 0)),
            uptime=int(time.time() - start),
        )
        time.sleep(5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["backtest", "paper"], required=True)
    args = parser.parse_args()

    # Make the workspace importable.
    sys.path.insert(0, str(Path(__file__).parent))

    if args.mode == "backtest":
        run_backtest()
    else:
        run_paper()


if __name__ == "__main__":
    main()
`;

function blankStatus(running: boolean): PaperStatus {
	return {
		running,
		unrealizedPnl: 0,
		realizedPnl: 0,
		openPositions: 0,
		uptime: 0,
	};
}
