import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
	TradeEntry,
} from "../types.js";

// The freqtrade container mounts workspace → /freqtrade/user_data.
// We organise everything under that single bind mount.
const USERDIR_IN_CONTAINER = "/freqtrade/user_data";
const DEFAULT_PAPER_API_PORT = 8080; // container port — we publish to a free host port per run

interface FreqtradeBacktestRaw {
	strategy: Record<string, FreqtradeStrategyResult>;
}

interface FreqtradeStrategyResult {
	profit_total?: number;
	max_drawdown?: number;
	max_drawdown_account?: number;
	winrate?: number;
	win_rate?: number;
	total_trades?: number;
	trade_count?: number;
	trades?: FreqtradeTrade[];
	profit_total_pct?: number;
}

interface FreqtradeTrade {
	pair: string;
	open_date: string;
	close_date: string;
	open_rate: number;
	close_rate: number;
	profit_abs: number;
	amount: number;
	is_short?: boolean;
}

// Legacy / simplified shape kept so existing fixture tests still pass.
interface LegacyFreqtradeResult {
	profit_total: number;
	max_drawdown: number;
	win_rate: number;
	trade_count: number;
	trades: FreqtradeTrade[];
}

export class FreqtradeAdapter implements EngineAdapter {
	readonly name = "freqtrade";

	async ensureImage(): Promise<void> {
		await ensureDockerAvailable();
		await pullImage(ENGINE_IMAGES.freqtrade);
	}

	async downloadData(config: DataConfig): Promise<DataRef> {
		const pairsArg = config.pairs.join(" ");
		const result = await runContainer({
			image: ENGINE_IMAGES.freqtrade,
			rm: true,
			volumes: [`${resolve(config.workspacePath)}:${USERDIR_IN_CONTAINER}`],
			command: [
				"download-data",
				"--userdir",
				USERDIR_IN_CONTAINER,
				"--exchange",
				config.exchange,
				"--pairs",
				...config.pairs,
				"--timeframes",
				config.timeframe,
				"--timerange",
				`${config.startDate.replaceAll("-", "")}-${config.endDate.replaceAll("-", "")}`,
			],
		});
		if (result.exitCode !== 0) {
			throw new DockerError(
				`freqtrade download-data failed for ${pairsArg}: ${result.stderr.trim()}`,
				result.exitCode,
				result.stderr,
			);
		}
		return {
			datasetId: crypto.randomUUID(),
			path: join(config.workspacePath, "data"),
		};
	}

	async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
		const workspaceAbs = resolve(config.workspacePath);
		const configFile = (config.extraParams?.configFile as string) ?? "config.json";
		const strategyName = (config.extraParams?.strategy as string) ?? "QuantDeskStrategy";
		const exportFilename = `backtest_${config.runId}.json`;

		const result = await runContainer({
			image: ENGINE_IMAGES.freqtrade,
			rm: true,
			volumes: [`${workspaceAbs}:${USERDIR_IN_CONTAINER}`],
			cpus: "2",
			memory: "2g",
			command: [
				"backtesting",
				"--userdir",
				USERDIR_IN_CONTAINER,
				"--config",
				`${USERDIR_IN_CONTAINER}/${configFile}`,
				"--strategy",
				strategyName,
				"--export",
				"trades",
				"--export-filename",
				`${USERDIR_IN_CONTAINER}/backtest_results/${exportFilename}`,
			],
		});

		if (result.exitCode !== 0) {
			throw new DockerError(
				`freqtrade backtesting failed: ${result.stderr.trim() || result.stdout.trim()}`,
				result.exitCode,
				result.stderr,
			);
		}

		// Read the exported JSON — freqtrade writes `backtest_results/<name>.json`
		// plus a `.meta.json` companion. Prefer the main result file.
		const resultsDir = join(workspaceAbs, "backtest_results");
		const resultFile = findLatestResultFile(resultsDir, exportFilename);
		if (!resultFile) {
			throw new Error(
				`freqtrade backtesting completed but no result file found under ${resultsDir}`,
			);
		}
		const raw = readFileSync(resultFile, "utf-8");
		const normalized = this.parseResult(raw);
		return { raw, normalized };
	}

	async startPaper(config: PaperConfig): Promise<PaperHandle> {
		await ensureDockerAvailable();
		const workspaceAbs = resolve(config.workspacePath);
		const containerName = `quantdesk-paper-${config.runId}`;
		const hostApiPort = await pickFreePort();

		// Rewrite config.json with dry_run + api_server enabled, preserving
		// everything else the agent wrote.
		const configPath = join(workspaceAbs, "config.json");
		const baseConfig = existsSync(configPath)
			? JSON.parse(readFileSync(configPath, "utf-8"))
			: {};
		const patched = {
			...baseConfig,
			dry_run: true,
			dry_run_wallet: config.wallet,
			exchange: {
				...(baseConfig.exchange ?? {}),
				name: config.exchange,
				pair_whitelist: config.pairs,
				key: "",
				secret: "",
			},
			api_server: {
				enabled: true,
				listen_ip_address: "0.0.0.0",
				listen_port: DEFAULT_PAPER_API_PORT,
				username: "quantdesk",
				password: "quantdesk",
				CORS_origins: [],
				verbosity: "error",
			},
		};
		if (config.timeframe) patched.timeframe = config.timeframe;
		writeFileSync(configPath, JSON.stringify(patched, null, 2));

		const strategyName = "QuantDeskStrategy";

		await runDetached({
			image: ENGINE_IMAGES.freqtrade,
			name: containerName,
			labels: quantdeskLabels({
				runId: config.runId,
				engine: "freqtrade",
				kind: "paper",
			}),
			volumes: [`${workspaceAbs}:${USERDIR_IN_CONTAINER}`],
			ports: [`127.0.0.1:${hostApiPort}:${DEFAULT_PAPER_API_PORT}`],
			cpus: "1",
			memory: "1g",
			command: [
				"trade",
				"--userdir",
				USERDIR_IN_CONTAINER,
				"--config",
				`${USERDIR_IN_CONTAINER}/config.json`,
				"--strategy",
				strategyName,
			],
		});

		return {
			containerName,
			runId: config.runId,
			meta: { apiPort: hostApiPort, apiUrl: `http://127.0.0.1:${hostApiPort}` },
		};
	}

	async stopPaper(handle: PaperHandle): Promise<void> {
		// Ask freqtrade's REST API to stop first (graceful), then SIGTERM the
		// container, then remove it.
		const apiUrl = handle.meta?.apiUrl as string | undefined;
		if (apiUrl) {
			try {
				await fetch(`${apiUrl}/api/v1/stop`, {
					method: "POST",
					headers: {
						Authorization: `Basic ${Buffer.from("quantdesk:quantdesk").toString("base64")}`,
					},
					signal: AbortSignal.timeout(3000),
				});
			} catch {
				// graceful stop failed — fall through to docker stop
			}
		}
		await stopContainer(handle.containerName, 10);
		await removeContainer(handle.containerName);
	}

	async getPaperStatus(handle: PaperHandle): Promise<PaperStatus> {
		const apiUrl = handle.meta?.apiUrl as string | undefined;
		if (!apiUrl) {
			return blankStatus(false);
		}
		const auth = `Basic ${Buffer.from("quantdesk:quantdesk").toString("base64")}`;
		try {
			const [statusRes, profitRes] = await Promise.all([
				fetch(`${apiUrl}/api/v1/status`, {
					headers: { Authorization: auth },
					signal: AbortSignal.timeout(3000),
				}),
				fetch(`${apiUrl}/api/v1/profit`, {
					headers: { Authorization: auth },
					signal: AbortSignal.timeout(3000),
				}),
			]);
			if (!statusRes.ok || !profitRes.ok) {
				return blankStatus(false);
			}
			const statusJson = (await statusRes.json()) as FreqtradeOpenTrade[];
			const profitJson = (await profitRes.json()) as FreqtradeProfit;
			const unrealizedPnl = statusJson.reduce(
				(sum, t) => sum + (t.profit_abs ?? 0),
				0,
			);
			return {
				running: true,
				unrealizedPnl,
				realizedPnl: profitJson.profit_closed_coin ?? profitJson.profit_all_coin ?? 0,
				openPositions: statusJson.length,
				uptime: profitJson.bot_start_date
					? Math.max(
							0,
							Math.floor((Date.now() - new Date(profitJson.bot_start_date).getTime()) / 1000),
						)
					: 0,
			};
		} catch {
			// Fallback: check container logs so we don't hard-fail a caller who
			// just wants a snapshot. If logs succeed, the container is at least alive.
			try {
				await logsFrom(handle.containerName, { tail: 1 });
				return blankStatus(true);
			} catch {
				return blankStatus(false);
			}
		}
	}

	parseResult(raw: string): NormalizedResult {
		let data: LegacyFreqtradeResult | FreqtradeBacktestRaw;
		try {
			data = JSON.parse(raw);
		} catch {
			throw new Error("Failed to parse freqtrade result: invalid JSON");
		}

		// Detect shape: the full freqtrade export has a top-level `strategy` key,
		// whereas the simpler fixture we already ship is flat.
		if (isStrategyScopedResult(data)) {
			const strategyName = Object.keys(data.strategy)[0];
			if (!strategyName) {
				throw new Error("Failed to parse freqtrade result: no strategies in export");
			}
			const strat = data.strategy[strategyName]!;
			return normaliseFreqtradeResult(strat);
		}

		return normaliseFreqtradeResult(data as unknown as FreqtradeStrategyResult);
	}
}

function normaliseFreqtradeResult(strat: FreqtradeStrategyResult): NormalizedResult {
	const totalTrades = strat.total_trades ?? strat.trade_count;
	if (typeof totalTrades !== "number") {
		throw new Error("Failed to parse freqtrade result: missing trade count");
	}
	const profit =
		typeof strat.profit_total_pct === "number"
			? strat.profit_total_pct
			: typeof strat.profit_total === "number"
				? strat.profit_total * 100
				: undefined;
	if (profit === undefined) {
		throw new Error("Failed to parse freqtrade result: missing profit total");
	}

	const drawdown = strat.max_drawdown_account ?? strat.max_drawdown ?? 0;
	const winRate = strat.winrate ?? strat.win_rate ?? 0;

	const trades: TradeEntry[] = (strat.trades ?? []).map((t) => ({
		pair: t.pair,
		side: t.is_short ? ("sell" as const) : ("buy" as const),
		price: t.open_rate,
		amount: t.amount,
		pnl: t.profit_abs,
		openedAt: t.open_date,
		closedAt: t.close_date,
	}));

	return {
		returnPct: profit,
		drawdownPct: -Math.abs(drawdown),
		winRate,
		totalTrades,
		trades,
	};
}

function isStrategyScopedResult(data: unknown): data is FreqtradeBacktestRaw {
	return (
		typeof data === "object" &&
		data !== null &&
		"strategy" in data &&
		typeof (data as FreqtradeBacktestRaw).strategy === "object"
	);
}

function findLatestResultFile(dir: string, preferredName: string): string | null {
	if (!existsSync(dir)) return null;
	const preferred = join(dir, preferredName);
	if (existsSync(preferred)) return preferred;
	const entries = readdirSync(dir)
		.filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
		.map((f) => join(dir, f));
	if (entries.length === 0) return null;
	entries.sort();
	return entries[entries.length - 1]!;
}

async function pickFreePort(): Promise<number> {
	const { createServer } = await import("node:net");
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.unref();
		srv.on("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			if (!addr || typeof addr === "string") {
				srv.close();
				reject(new Error("Failed to pick free port"));
				return;
			}
			const port = addr.port;
			srv.close(() => resolve(port));
		});
	});
}

interface FreqtradeOpenTrade {
	profit_abs?: number;
}

interface FreqtradeProfit {
	profit_closed_coin?: number;
	profit_all_coin?: number;
	bot_start_date?: string;
}

function blankStatus(running: boolean): PaperStatus {
	return {
		running,
		unrealizedPnl: 0,
		realizedPnl: 0,
		openPositions: 0,
		uptime: 0,
	};
}
