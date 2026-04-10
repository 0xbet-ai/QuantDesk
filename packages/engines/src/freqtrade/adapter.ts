import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import AdmZip from "adm-zip";
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
	PaperCandle,
	PaperConfig,
	PaperHandle,
	PaperStatus,
	PaperTrade,
	TradeEntry,
} from "../types.js";

// The freqtrade container mounts workspace → /freqtrade/user_data.
// We organise everything under that single bind mount.
const USERDIR_IN_CONTAINER = "/freqtrade/user_data";

// Shadow the host `.git` directory with an in-container tmpfs. The workspace
// is a per-desk git checkout, and freqtrade's entrypoint runs
// `chown -R ftuser /freqtrade/user_data`, which fails loudly on git's
// host-owned read-only object files (`Permission denied` spam). freqtrade
// itself never needs `.git`, so shadowing it keeps chown happy and keeps the
// host repo untouched.
const GIT_SHADOW_TMPFS = [`${USERDIR_IN_CONTAINER}/.git`];
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
		// Mount either the caller-provided cache root or the workspace as
		// freqtrade's user_data dir. Using a shared cache root lets multiple
		// desks reuse the same download without pulling twice.
		const userDirHost = resolve(config.userDir ?? config.workspacePath);
		const cmd = [
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
		];
		if (config.tradingMode && config.tradingMode !== "spot") {
			cmd.push("--trading-mode", config.tradingMode);
		}
		const result = await runContainer(
			{
				image: ENGINE_IMAGES.freqtrade,
				rm: true,
				volumes: [`${userDirHost}:${USERDIR_IN_CONTAINER}`],
				tmpfs: GIT_SHADOW_TMPFS,
				command: cmd,
			},
			config.onLogLine
				? {
						onStdoutLine: (line) => config.onLogLine!(line, "stdout"),
						onStderrLine: (line) => config.onLogLine!(line, "stderr"),
					}
				: undefined,
		);
		if (result.exitCode !== 0) {
			throw new DockerError(
				`freqtrade download-data failed for ${pairsArg}: ${result.stderr.trim()}`,
				result.exitCode,
				result.stderr,
			);
		}
		return {
			datasetId: crypto.randomUUID(),
			path: join(userDirHost, "data"),
		};
	}

	async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
		const workspaceAbs = resolve(config.workspacePath);
		const configFile = (config.extraParams?.configFile as string) ?? "config.json";
		const strategyName = (config.extraParams?.strategy as string) ?? "QuantDeskStrategy";
		const exportFilename = `backtest_${config.runId}.json`;

		// Patch config.json: inject `pairlists` if missing (required by
		// freqtrade 2026.x). Data download is NOT the adapter's job — the
		// agent asks the user and emits [DATA_FETCH], and the server's
		// data-fetch handler runs download-data separately before
		// [RUN_BACKTEST] is emitted.
		const cfgPath = join(workspaceAbs, configFile);
		if (existsSync(cfgPath)) {
			try {
				const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
				if (!cfg.pairlists) {
					cfg.pairlists = [{ method: "StaticPairList" }];
					writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
				}
			} catch (err) {
				if (err instanceof SyntaxError) {
					throw new Error(`Invalid ${configFile}: ${err.message}`);
				}
				throw err;
			}
		}

		const containerName = `quantdesk-ft-backtest-${config.runId.slice(0, 8)}`;
		const result = await runContainer(
			{
				image: ENGINE_IMAGES.freqtrade,
				name: containerName,
				rm: true,
				volumes: [`${workspaceAbs}:${USERDIR_IN_CONTAINER}`, ...(config.extraVolumes ?? [])],
				tmpfs: GIT_SHADOW_TMPFS,
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
					"--strategy-path",
					USERDIR_IN_CONTAINER,
					"--export",
					"trades",
					"--export-filename",
					`${USERDIR_IN_CONTAINER}/backtest_results/${exportFilename}`,
				],
			},
			{
				onStdoutLine: config.onLogLine
					? (line) => config.onLogLine!(line, "stdout")
					: undefined,
				onStderrLine: config.onLogLine
					? (line) => config.onLogLine!(line, "stderr")
					: undefined,
			},
		);

		if (result.exitCode !== 0) {
			throw new DockerError(
				`freqtrade backtesting exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
				result.exitCode,
				result.stderr,
			);
		}

		// Source of truth: the exported result file. freqtrade can exit 0 on
		// config validation errors or empty data — in that case no file is
		// written, and we surface the last log lines so the caller can see why.
		const resultsDir = join(workspaceAbs, "backtest_results");
		const resultFile = findLatestResultFile(resultsDir, exportFilename);
		if (!resultFile) {
			const tail = lastLines(result.stderr || result.stdout, 10);
			throw new Error(
				`freqtrade backtesting produced no result file under ${resultsDir}. Last log lines:\n${tail}`,
			);
		}
		const raw = readResultFile(resultFile);
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
		const baseConfig = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};
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
			volumes: [`${workspaceAbs}:${USERDIR_IN_CONTAINER}`, ...(config.extraVolumes ?? [])],
			tmpfs: GIT_SHADOW_TMPFS,
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
				"--strategy-path",
				USERDIR_IN_CONTAINER,
			],
		});

		// Wait for the API server to be ready, then tell the bot to start
		// trading. Freqtrade launches with state=STOPPED when an api_server
		// is configured — it waits for an explicit /api/v1/start call.
		const apiUrl = `http://127.0.0.1:${hostApiPort}`;
		const auth = `Basic ${Buffer.from("quantdesk:quantdesk").toString("base64")}`;
		for (let attempt = 0; attempt < 30; attempt++) {
			try {
				const res = await fetch(`${apiUrl}/api/v1/ping`, {
					headers: { Authorization: auth },
					signal: AbortSignal.timeout(2000),
				});
				if (res.ok) {
					// API is ready — start the bot
					await fetch(`${apiUrl}/api/v1/start`, {
						method: "POST",
						headers: { Authorization: auth },
						signal: AbortSignal.timeout(3000),
					});
					break;
				}
			} catch {
				// API not ready yet
			}
			await new Promise((r) => setTimeout(r, 1000));
		}

		return {
			containerName,
			runId: config.runId,
			meta: { apiPort: hostApiPort, apiUrl },
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
			const unrealizedPnl = statusJson.reduce((sum, t) => sum + (t.profit_abs ?? 0), 0);
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

	async getPaperTrades(handle: PaperHandle): Promise<PaperTrade[]> {
		const apiUrl = handle.meta?.apiUrl as string | undefined;
		if (!apiUrl) return [];
		const auth = `Basic ${Buffer.from("quantdesk:quantdesk").toString("base64")}`;
		try {
			const res = await fetch(`${apiUrl}/api/v1/trades?limit=100`, {
				headers: { Authorization: auth },
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) return [];
			const data = (await res.json()) as { trades: FreqtradeTrade[] };
			return (data.trades ?? []).map((t, i) => ({
				id: String(i),
				pair: t.pair,
				side: t.is_short ? "short" as const : "long" as const,
				openDate: t.open_date,
				closeDate: t.close_date || null,
				openRate: t.open_rate,
				closeRate: t.close_rate ?? null,
				profitAbs: t.profit_abs ?? 0,
				profitPct: t.profit_abs != null && t.open_rate > 0 && t.amount > 0
					? (t.profit_abs / (t.open_rate * t.amount)) * 100
					: 0,
				isOpen: !t.close_date,
			}));
		} catch {
			return [];
		}
	}

	async getPaperCandles(handle: PaperHandle, pair: string, timeframe: string): Promise<PaperCandle[]> {
		const apiUrl = handle.meta?.apiUrl as string | undefined;
		if (!apiUrl) return [];
		const auth = `Basic ${Buffer.from("quantdesk:quantdesk").toString("base64")}`;
		try {
			const params = new URLSearchParams({ pair, timeframe, limit: "500" });
			const res = await fetch(`${apiUrl}/api/v1/pair_candles?${params}`, {
				headers: { Authorization: auth },
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) return [];
			const data = (await res.json()) as { data: number[][] };
			return (data.data ?? []).map((c) => ({
				time: Math.floor(c[0]! / 1000),
				open: c[1]!,
				high: c[2]!,
				low: c[3]!,
				close: c[4]!,
				volume: c[5]!,
			}));
		} catch {
			return [];
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

	workspaceTemplate(opts?: { venue?: string }): Record<string, string> {
		const exchangeName = opts?.venue ?? "binance";
		return {
			"strategy.py": `# Freqtrade Strategy
class QuantDeskStrategy:
    """Strategy generated by QuantDesk agent."""

    INTERFACE_VERSION = 3
    minimal_roi = {"0": 0.1}
    stoploss = -0.05
    timeframe = "5m"

    def populate_indicators(self, dataframe, metadata):
        return dataframe

    def populate_entry_trend(self, dataframe, metadata):
        return dataframe

    def populate_exit_trend(self, dataframe, metadata):
        return dataframe
`,
			"config.json": JSON.stringify(
				{
					trading_mode: "spot",
					stake_currency: "USDT",
					stake_amount: "unlimited",
					dry_run: true,
					exchange: { name: exchangeName, key: "", secret: "" },
				},
				null,
				2,
			),
		};
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

	// max_drawdown_account is 0–1 ratio; max_drawdown is already percent.
	const drawdownPct =
		typeof strat.max_drawdown_account === "number"
			? strat.max_drawdown_account * 100
			: strat.max_drawdown ?? 0;
	// winrate / win_rate from freqtrade is 0–1 ratio.
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
		drawdownPct: -Math.abs(drawdownPct),
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

function lastLines(text: string, n: number): string {
	if (!text) return "(no output)";
	const lines = text.trimEnd().split("\n");
	return lines.slice(-n).join("\n");
}

function findLatestResultFile(dir: string, preferredName: string): string | null {
	if (!existsSync(dir)) return null;

	// 1. Check exact preferred name (.json)
	const preferred = join(dir, preferredName);
	if (existsSync(preferred)) return preferred;

	// 2. freqtrade 2026.3+ writes .zip instead of .json and ignores
	//    --export-filename. Try .last_result.json which points to the
	//    actual file (zip or json).
	const lastResultPath = join(dir, ".last_result.json");
	if (existsSync(lastResultPath)) {
		try {
			const meta = JSON.parse(readFileSync(lastResultPath, "utf-8"));
			const target = meta.latest_backtest ?? meta.latest_backtest_filename;
			if (typeof target === "string") {
				const resolved = join(dir, target);
				if (existsSync(resolved)) return resolved;
			}
		} catch {
			// Corrupt .last_result.json — fall through to scan.
		}
	}

	// 3. Scan for .zip or .json (prefer zip, then json, newest first).
	const entries = readdirSync(dir)
		.filter(
			(f) =>
				(f.endsWith(".json") || f.endsWith(".zip")) &&
				!f.endsWith(".meta.json") &&
				!f.startsWith("."),
		)
		.map((f) => join(dir, f));
	if (entries.length === 0) return null;
	entries.sort();
	return entries[entries.length - 1]!;
}

/** Read backtest result JSON from a .json or .zip file. */
function readResultFile(filePath: string): string {
	if (filePath.endsWith(".zip")) {
		const zip = new AdmZip(filePath);
		const jsonEntry = zip.getEntries().find((e) => e.entryName.endsWith(".json"));
		if (!jsonEntry) {
			throw new Error(`No JSON entry found inside ${filePath}`);
		}
		return jsonEntry.getData().toString("utf-8");
	}
	return readFileSync(filePath, "utf-8");
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
