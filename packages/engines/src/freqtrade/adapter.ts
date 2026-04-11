import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
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
				onStdoutLine: config.onLogLine ? (line) => config.onLogLine!(line, "stdout") : undefined,
				onStderrLine: config.onLogLine ? (line) => config.onLogLine!(line, "stderr") : undefined,
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

		// Read the agent-owned workspace config as the base. We never
		// write back to this file — the previous implementation
		// overwrote `workspace/config.json` with server-authored fields
		// (dry_run, api_server, pair_whitelist override) and the
		// commit-per-turn loop baked those mutations into workspace git
		// history. Before the `cf38239` hardcoded BTC/USDT was fixed,
		// this mechanism permanently corrupted the 8a31276e desk's
		// config.json on paper start — and the corruption survived the
		// fix because the bad value was already in git.
		//
		// Today: read workspace/config.json as source-of-truth, build
		// the overlay in memory, and write it to a scratch host path
		// OUTSIDE the workspace. The scratch file is bind-mounted
		// read-only into the container, so workspace/config.json is
		// never touched by the server and can never again be
		// accidentally committed.
		const sourceConfigPath = join(workspaceAbs, "config.json");
		const baseConfig = existsSync(sourceConfigPath)
			? JSON.parse(readFileSync(sourceConfigPath, "utf-8"))
			: {};
		// Preserve whatever trading_mode the agent set in config.json.
		// If the agent wrote perp pairs with spot mode, freqtrade will
		// reject them with a clear error — don't silently override. The
		// fail-fast whitelist check after /api/v1/start catches any
		// resulting empty whitelist and refuses to return a healthy
		// handle.
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

		// Scratch location for the paper overlay config — outside the
		// workspace so it can never be picked up by the commit-per-turn
		// loop. Path is keyed by runId so the boot reconcile can find
		// the right file for each surviving paper container on restart.
		const scratchDir = join(homedir(), ".quantdesk", "paper-configs");
		mkdirSync(scratchDir, { recursive: true });
		const scratchConfigPath = join(scratchDir, `${config.runId}.json`);
		writeFileSync(scratchConfigPath, JSON.stringify(patched, null, 2));

		const strategyName = "QuantDeskStrategy";
		// The paper overlay lives outside user_data so freqtrade's
		// entrypoint doesn't try to chown it to ftuser.
		const PAPER_CONFIG_IN_CONTAINER = "/freqtrade/paper-config.json";

		await runDetached({
			image: ENGINE_IMAGES.freqtrade,
			name: containerName,
			labels: quantdeskLabels({
				runId: config.runId,
				engine: "freqtrade",
				kind: "paper",
			}),
			volumes: [
				`${workspaceAbs}:${USERDIR_IN_CONTAINER}`,
				// Single-file read-only bind mount: server-authored paper
				// overlay, never touched by the agent, never mutated by
				// the container.
				`${scratchConfigPath}:${PAPER_CONFIG_IN_CONTAINER}:ro`,
				...(config.extraVolumes ?? []),
			],
			tmpfs: GIT_SHADOW_TMPFS,
			ports: [`127.0.0.1:${hostApiPort}:${DEFAULT_PAPER_API_PORT}`],
			cpus: "1",
			memory: "1g",
			command: [
				"trade",
				"--userdir",
				USERDIR_IN_CONTAINER,
				"--config",
				PAPER_CONFIG_IN_CONTAINER,
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
		let apiReady = false;
		for (let attempt = 0; attempt < 30; attempt++) {
			try {
				const res = await fetch(`${apiUrl}/api/v1/ping`, {
					headers: { Authorization: auth },
					signal: AbortSignal.timeout(2000),
				});
				if (res.ok) {
					apiReady = true;
					// API is ready — start the bot
					const startRes = await fetch(`${apiUrl}/api/v1/start`, {
						method: "POST",
						headers: { Authorization: auth },
						signal: AbortSignal.timeout(3000),
					});
					if (!startRes.ok) {
						throw new Error(`/api/v1/start returned ${startRes.status}`);
					}
					break;
				}
			} catch (err) {
				if (apiReady) throw err; // API was ready but /start failed
			}
			await new Promise((r) => setTimeout(r, 1000));
		}
		if (!apiReady) {
			throw new Error(
				`Freqtrade API did not become ready within 30s on port ${hostApiPort}. Container may have crashed.`,
			);
		}

		// Fail-fast whitelist validation.
		// freqtrade silently strips pairs from `pair_whitelist` that aren't
		// compatible with the exchange — e.g. `BTC/USDT` on Hyperliquid (which
		// is USDC-native). The bot then runs happily with an empty whitelist,
		// doing absolutely nothing, and the server previously marked the
		// session as "running" because the health check only asked the API
		// for its heartbeat. That masked the BTC/USDT / Hyperliquid mismatch
		// for a full day of paper trading.
		//
		// Query `/api/v1/whitelist` immediately after /start and refuse to
		// return a "healthy" handle if the configured pairs got dropped.
		// The caller (paper-sessions) will then mark the session failed
		// with a clear error the agent can react to.
		try {
			const wlRes = await fetch(`${apiUrl}/api/v1/whitelist`, {
				headers: { Authorization: auth },
				signal: AbortSignal.timeout(3000),
			});
			if (wlRes.ok) {
				const wlJson = (await wlRes.json()) as { whitelist?: string[] };
				const effective = wlJson.whitelist ?? [];
				if (effective.length === 0) {
					// Stop + remove the container we just started so we don't
					// leave zombies behind when paper-sessions catches this.
					try {
						await stopContainer(containerName, 5);
					} catch {
						/* best effort */
					}
					try {
						await removeContainer(containerName);
					} catch {
						/* best effort */
					}
					const requested = config.pairs.join(", ");
					throw new Error(
						`Freqtrade accepted ${requested} on ${config.exchange} but then dropped every pair — the effective whitelist is empty. Hyperliquid is USDC-native (no USDT); other venues may reject unsupported quote currencies or spot/futures mismatches. Fix \`exchange.pair_whitelist\` (and \`trading_mode\` if needed) in workspace/config.json and retry.`,
					);
				}
				const missing = config.pairs.filter((p) => !effective.includes(p));
				if (missing.length > 0) {
					try {
						await stopContainer(containerName, 5);
					} catch {
						/* best effort */
					}
					try {
						await removeContainer(containerName);
					} catch {
						/* best effort */
					}
					throw new Error(
						`Freqtrade dropped ${missing.join(", ")} from the effective whitelist on ${config.exchange} (kept: ${effective.join(", ") || "none"}). Check pair naming and trading_mode in workspace/config.json.`,
					);
				}
			}
			// If the whitelist endpoint returned non-200, don't block the start
			// — freqtrade versions vary and we'd rather have a working session
			// than a false negative. The paper.log stream will still surface
			// any real problem.
		} catch (err) {
			if (err instanceof Error && err.message.startsWith("Freqtrade")) {
				throw err;
			}
			// Network / timeout — don't treat as a hard failure, same reasoning
			// as above.
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
		// Clean up the scratch paper overlay for this session. Best-effort:
		// if the file was already deleted or was never created (pre-redesign
		// session on an older server), ignore the error.
		try {
			const scratchPath = join(homedir(), ".quantdesk", "paper-configs", `${handle.runId}.json`);
			unlinkSync(scratchPath);
		} catch {
			/* already gone or never existed */
		}
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
				// `bot_start_date` from /api/v1/profit is a timezone-naive
				// datetime string ("2026-04-11 12:22:59") in UTC. JS
				// `new Date(naiveString)` parses it as *local* time, which
				// on a KST host produces a value 9h behind UTC → uptime
				// inflates by 9h. Force UTC by appending "Z".
				uptime: profitJson.bot_start_date
					? Math.max(
							0,
							Math.floor(
								(Date.now() -
									new Date(
										profitJson.bot_start_date.endsWith("Z")
											? profitJson.bot_start_date
											: `${profitJson.bot_start_date.replace(" ", "T")}Z`,
									).getTime()) /
									1000,
							),
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
				side: t.is_short ? ("short" as const) : ("long" as const),
				openDate: t.open_date,
				closeDate: t.close_date || null,
				openRate: t.open_rate,
				closeRate: t.close_rate ?? null,
				profitAbs: t.profit_abs ?? 0,
				profitPct:
					t.profit_abs != null && t.open_rate > 0 && t.amount > 0
						? (t.profit_abs / (t.open_rate * t.amount)) * 100
						: 0,
				isOpen: !t.close_date,
			}));
		} catch {
			return [];
		}
	}

	async getPaperCandles(
		handle: PaperHandle,
		pair: string,
		timeframe: string,
	): Promise<PaperCandle[]> {
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
			// Freqtrade returns column 0 as an ISO date STRING
			// ("2026-04-11T12:15:00Z"), not a unix number. Previously we did
			// `c[0] / 1000` which produced NaN → JSON null → lightweight-charts
			// silently rendered nothing. Parse the string into seconds.
			const data = (await res.json()) as { data: (string | number)[][] };
			return (data.data ?? []).map((c) => ({
				time: Math.floor(new Date(c[0] as string).getTime() / 1000),
				open: c[1] as number,
				high: c[2] as number,
				low: c[3] as number,
				close: c[4] as number,
				volume: c[5] as number,
			}));
		} catch {
			return [];
		}
	}

	/**
	 * Build a one-line "market tick" summary from the current forming
	 * candle so the paper.log stream shows live price + indicator state
	 * alongside freqtrade's own heartbeat.
	 *
	 * Index by column name (not position) because the indicator set
	 * depends on what the strategy populated — `adx`, `fastd`, `fastk`,
	 * `rsi`, `macd`, etc. We opportunistically surface the ones we
	 * recognise; anything else is ignored to keep the line terse.
	 *
	 * Returns null on network error / empty response so the caller can
	 * distinguish "engine isn't ready yet" from a real tick.
	 */
	async getPaperMarketTickLine(
		handle: PaperHandle,
		pair: string,
		timeframe: string,
	): Promise<string | null> {
		const apiUrl = handle.meta?.apiUrl as string | undefined;
		if (!apiUrl) return null;
		const auth = `Basic ${Buffer.from("quantdesk:quantdesk").toString("base64")}`;
		try {
			const params = new URLSearchParams({ pair, timeframe, limit: "1" });
			const res = await fetch(`${apiUrl}/api/v1/pair_candles?${params}`, {
				headers: { Authorization: auth },
				signal: AbortSignal.timeout(3000),
			});
			if (!res.ok) return null;
			const body = (await res.json()) as {
				columns?: string[];
				data?: (string | number | null)[][];
			};
			const cols = body.columns ?? [];
			const row = body.data?.[body.data.length - 1];
			if (!row) return null;
			const get = (name: string): number | string | null => {
				const i = cols.indexOf(name);
				if (i < 0) return null;
				const v = row[i];
				return v === undefined ? null : v;
			};
			const rawDate = get("date");
			const close = get("close");
			const adx = get("adx");
			const fastd = get("fastd");
			const fastk = get("fastk");
			const rsi = get("rsi");
			const macd = get("macd");
			const enterLong = get("enter_long");
			const exitLong = get("exit_long");

			const fmtNum = (v: number | string | null, digits: number): string => {
				if (typeof v !== "number" || !Number.isFinite(v)) return "—";
				return v.toFixed(digits);
			};
			const parts: string[] = [];
			parts.push(`close=${typeof close === "number" ? close.toFixed(close >= 1000 ? 2 : 4) : "—"}`);
			if (adx !== null) parts.push(`adx=${fmtNum(adx, 1)}`);
			if (fastd !== null) parts.push(`fastd=${fmtNum(fastd, 1)}`);
			if (fastk !== null) parts.push(`fastk=${fmtNum(fastk, 1)}`);
			if (rsi !== null) parts.push(`rsi=${fmtNum(rsi, 1)}`);
			if (macd !== null) parts.push(`macd=${fmtNum(macd, 4)}`);
			const signals: string[] = [];
			if (enterLong === 1 || enterLong === 1.0) signals.push("ENTRY");
			if (exitLong === 1 || exitLong === 1.0) signals.push("EXIT");
			parts.push(`signal=${signals.length ? signals.join("+") : "—"}`);
			const dateStr = typeof rawDate === "string" ? rawDate : "—";
			return `[market] ${pair} ${timeframe} ${dateStr} ${parts.join(" ")}`;
		} catch {
			return null;
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
			// Keep engine outputs and heavy caches out of the per-desk git
			// workspace so every commit captures only reproducible *inputs*
			// (strategy.py, config.json, agent-written scripts). Without
			// this, `git add -A` in commitCode() pulls in backtest_results
			// zips and bloats every commit with non-reproducible outputs.
			".gitignore": [
				"# engine outputs",
				"backtest_results/",
				"hyperopt_results/",
				"logs/",
				"freqaimodels/",
				".last_result.json",
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
			: (strat.max_drawdown ?? 0);
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
