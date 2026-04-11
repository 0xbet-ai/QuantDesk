import {
	CandlestickSeries,
	ColorType,
	type IChartApi,
	type ISeriesApi,
	type UTCTimestamp,
	createChart,
} from "lightweight-charts";
import { ArrowDownRight, ArrowUpRight, Pause } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveUpdates } from "../context/LiveUpdatesContext.js";
import { useTheme } from "../context/ThemeContext.js";
import type {
	Desk,
	PaperCandleItem,
	PaperSession,
	PaperStatusData,
	PaperTradeItem,
} from "../lib/api.js";
import {
	getActivePaperSession,
	getPaperCandles,
	getPaperStatus,
	getPaperTrades,
	stopPaperSession,
} from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface Props {
	desk: Desk;
}

type LogLevel = "info" | "warning" | "error" | "debug" | null;
interface PaperLogLine {
	id: number;
	stream: "stdout" | "stderr";
	line: string;
	level: LogLevel;
	at: string;
}
const MAX_LOG_LINES = 500;

/**
 * Parse a Python-logging-style level out of a freqtrade stdout/stderr
 * line. Freqtrade (and most python libs) writes ALL log levels to
 * stderr by default — INFO included — so colouring by stream alone
 * paints every heartbeat message red. Anchor instead on the ` - LEVEL - `
 * fragment that freqtrade's default formatter emits.
 *
 * Lines without a detectable level (our own synthetic `[market]` ticks,
 * ccxt raw exceptions, startup banners) return null so the caller can
 * fall back to the default foreground colour.
 */
function detectLogLevel(line: string): LogLevel {
	const m = line.match(/ - (DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL) - /);
	if (!m) return null;
	const raw = m[1];
	if (raw === "ERROR" || raw === "CRITICAL") return "error";
	if (raw === "WARNING" || raw === "WARN") return "warning";
	if (raw === "DEBUG") return "debug";
	return "info";
}

/**
 * Rewrite any UTC timestamps embedded in a log line into the user's
 * local timezone. Two formats get matched:
 *
 *   1. ISO 8601 with T and an optional `Z` / offset — freqtrade's
 *      `/api/v1/pair_candles` date column (`2026-04-11T13:05:00Z`),
 *      used by our own `[market]` synthetic lines.
 *   2. Python logging default — `2026-04-11 13:12:01,091` — freqtrade
 *      writes these from inside the docker container, which defaults
 *      to UTC.
 *
 * Both formats are replaced with `toLocaleString(undefined, ...)` so
 * the value is automatically rendered in whatever timezone the user's
 * browser is in. The rest of the line (indicator values, signal
 * flags, log level, message body) is left untouched.
 *
 * We do this at INGEST time (not render) so the transformed string
 * lives in state and the render loop is a pure string renderer.
 */
function localizeTimestamps(line: string): string {
	const fmt = (d: Date): string =>
		d.toLocaleString(undefined, {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	return line
		.replace(
			/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/g,
			(match) => {
				const d = new Date(match);
				if (Number.isNaN(d.getTime())) return match;
				return fmt(d);
			},
		)
		.replace(
			// Python-logging "YYYY-MM-DD HH:MM:SS[,ms]" — assume UTC (that's
			// the Docker default). Anchored with word boundaries so it
			// doesn't touch already-localized strings from the previous pass.
			/\b(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(,\d+)?\b/g,
			(_m, date: string, time: string) => {
				const d = new Date(`${date}T${time}Z`);
				if (Number.isNaN(d.getTime())) return `${date} ${time}`;
				return fmt(d);
			},
		);
}

function formatPnl(v: number): string {
	return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

function formatTime(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatUptime(sec: number): string {
	if (sec < 60) return `${sec}s`;
	const m = Math.floor(sec / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ${m % 60}m`;
	const d = Math.floor(h / 24);
	return `${d}d ${h % 24}h`;
}

export function PaperTradingView({ desk }: Props) {
	const { theme } = useTheme();
	const [session, setSession] = useState<PaperSession | null>(null);
	const [status, setStatus] = useState<PaperStatusData | null>(null);
	const [trades, setTrades] = useState<PaperTradeItem[]>([]);
	const [candles, setCandles] = useState<PaperCandleItem[]>([]);
	const [logs, setLogs] = useState<PaperLogLine[]>([]);
	const [stopping, setStopping] = useState(false);
	// Draggable divider between the trades panel and the container log
	// panel. Stored as a fraction (log's share of the combined region)
	// rather than pixels so the default layout is resolution-independent:
	// 0.7 means the log eats 70% of (trades + log) which is the "3:7"
	// ratio the user asked for. Clamped to [0.1, 0.9] on drag so neither
	// side can become unusably small.
	const [logFraction, setLogFraction] = useState(0.7);
	const splitContainerRef = useRef<HTMLDivElement>(null);
	const logIdRef = useRef(0);
	const logContainerRef = useRef<HTMLDivElement>(null);

	const startLogResize = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		const container = splitContainerRef.current;
		if (!container) return;
		const onMove = (ev: MouseEvent) => {
			const rect = container.getBoundingClientRect();
			if (rect.height <= 0) return;
			// Log occupies (container.bottom - cursorY) pixels; convert to
			// a 0..1 fraction against the split container's total height.
			const logPx = rect.bottom - ev.clientY;
			const fraction = Math.max(0.1, Math.min(0.9, logPx / rect.height));
			setLogFraction(fraction);
		};
		const onUp = () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	}, []);

	const chartContainerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

	// Derive pair + timeframe from the paper runs row config (set by
	// startPaper from config.json) — the session row is the single
	// source of truth. Previously this fell back to `"BTC/USDT"` if
	// meta.pairs was missing, which is the exact class of hardcoded
	// default that corrupted the 8a31276e desk via the old paper-sessions
	// bug. No fallback: if the meta is missing, candles are simply not
	// requested until the session row arrives.
	const sessionConfig = (session?.meta ?? {}) as Record<string, unknown>;
	const pair = (sessionConfig.pairs as string[] | undefined)?.[0] ?? null;
	const timeframe = (sessionConfig.timeframe as string) ?? null;

	const refresh = useCallback(() => {
		getActivePaperSession(desk.id)
			.then(setSession)
			.catch(() => {});
		getPaperStatus(desk.id)
			.then(setStatus)
			.catch(() => {});
		getPaperTrades(desk.id)
			.then(setTrades)
			.catch(() => {});
		if (pair && timeframe) {
			getPaperCandles(desk.id, pair, timeframe)
				.then(setCandles)
				.catch(() => {});
		}
	}, [desk.id, pair, timeframe]);

	useEffect(() => {
		refresh();
		const id = setInterval(refresh, 10000);
		return () => clearInterval(id);
	}, [refresh]);

	// Subscribe to live paper.log events pushed from the freqtrade
	// container's stdout. The server spawns `docker logs -f` and
	// forwards each line; we keep the most recent MAX_LOG_LINES in a
	// ring buffer so the console doesn't grow unbounded.
	useLiveUpdates(session?.experimentId ?? null, (event) => {
		if (event.type !== "paper.log") return;
		const payload = event.payload as {
			sessionId?: string;
			stream?: "stdout" | "stderr";
			line?: string;
		};
		if (!payload.line) return;
		if (session && payload.sessionId && payload.sessionId !== session.id) return;
		const nextId = logIdRef.current + 1;
		logIdRef.current = nextId;
		const rawLine = payload.line;
		const lineEntry: PaperLogLine = {
			id: nextId,
			stream: payload.stream === "stderr" ? "stderr" : "stdout",
			// Detect the level from the RAW line (level markers never
			// contain timestamps), then localize the timestamps for
			// display. Order matters: level detection must see the
			// untransformed text.
			level: detectLogLevel(rawLine),
			line: localizeTimestamps(rawLine),
			at: event.createdAt,
		};
		setLogs((prev) => {
			const next = [...prev, lineEntry];
			return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
		});
	});

	// Auto-scroll the log panel to the bottom whenever new lines arrive,
	// but only if the user is already near the bottom — so they can
	// pause to read without being yanked away. The `logs` dependency is
	// the signal for "new line arrived"; the effect body reads the DOM
	// via ref, not logs, so biome's exhaustive-deps would otherwise
	// flag the dep as unused.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `logs` triggers the scroll, even though the body only touches the DOM ref
	useEffect(() => {
		const el = logContainerRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
		if (nearBottom) el.scrollTop = el.scrollHeight;
	}, [logs]);

	const handleStop = async () => {
		setStopping(true);
		try {
			await stopPaperSession(desk.id);
			setSession(null);
			setStatus(null);
		} catch (err) {
			console.error(err);
		} finally {
			setStopping(false);
		}
	};

	// Chart setup
	useEffect(() => {
		if (!chartContainerRef.current) return;
		const isDark = theme === "dark";
		const chart = createChart(chartContainerRef.current, {
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: isDark ? "#a1a1aa" : "#71717a",
			},
			grid: {
				vertLines: { color: isDark ? "#27272a" : "#f4f4f5" },
				horzLines: { color: isDark ? "#27272a" : "#f4f4f5" },
			},
			width: chartContainerRef.current.clientWidth,
			height: 300,
			timeScale: { timeVisible: true, secondsVisible: false },
			crosshair: { mode: 0 },
		});
		chartRef.current = chart;
		const series = chart.addSeries(CandlestickSeries, {
			upColor: "#22c55e",
			downColor: "#ef4444",
			borderUpColor: "#22c55e",
			borderDownColor: "#ef4444",
			wickUpColor: "#22c55e",
			wickDownColor: "#ef4444",
		});
		candleSeriesRef.current = series;

		const ro = new ResizeObserver(() => {
			if (chartContainerRef.current) {
				chart.applyOptions({ width: chartContainerRef.current.clientWidth });
			}
		});
		ro.observe(chartContainerRef.current);

		return () => {
			ro.disconnect();
			chart.remove();
			chartRef.current = null;
			candleSeriesRef.current = null;
		};
	}, [theme]);

	// Update candle data
	useEffect(() => {
		if (!candleSeriesRef.current || candles.length === 0) return;
		const series = candleSeriesRef.current;
		series.setData(
			candles.map((c) => ({
				time: c.time as UTCTimestamp,
				open: c.open,
				high: c.high,
				low: c.low,
				close: c.close,
			})),
		);

		// Add trade markers (Buy/Sell) on the chart
		const markers = trades
			.filter((t) => t.openDate)
			.map((t) => {
				const pos: "belowBar" | "aboveBar" = t.side === "long" ? "belowBar" : "aboveBar";
				const shp: "arrowUp" | "arrowDown" = t.side === "long" ? "arrowUp" : "arrowDown";
				return {
					time: Math.floor(new Date(t.openDate).getTime() / 1000) as UTCTimestamp,
					position: pos,
					color: t.side === "long" ? "#22c55e" : "#ef4444",
					shape: shp,
					text: t.side === "long" ? "B" : "S",
				};
			})
			.sort((a, b) => (a.time as number) - (b.time as number));
		if (markers.length > 0) {
			(series as unknown as { setMarkers: (m: typeof markers) => void }).setMarkers(markers);
		}
	}, [candles, trades]);

	const isRunning = session?.status === "running";

	if (!session || (session.status !== "running" && session.status !== "pending")) {
		return (
			<div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
				No active paper trading session. Start one from the Properties panel.
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="h-12 shrink-0 border-b border-border flex items-center px-6 gap-3">
				<div className="flex items-center gap-2">
					<span className="relative flex h-2 w-2">
						<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-70" />
						<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
					</span>
					<span className="text-sm font-medium">Paper Trading</span>
					{status && (
						<span className="text-xs text-muted-foreground">{formatUptime(status.uptime)}</span>
					)}
				</div>
				<div className="flex-1" />
				{/* PnL summary */}
				{status && (
					<div className="flex items-center gap-4 text-xs tabular-nums">
						<div>
							<span className="text-muted-foreground mr-1">PnL</span>
							<span
								className={cn(
									"font-mono font-medium",
									status.unrealizedPnl + status.realizedPnl >= 0
										? "text-green-500"
										: "text-red-500",
								)}
							>
								{formatPnl(status.unrealizedPnl + status.realizedPnl)}
							</span>
						</div>
						<div>
							<span className="text-muted-foreground mr-1">Positions</span>
							<span className="font-mono font-medium">{status.openPositions}</span>
						</div>
					</div>
				)}
				<button
					type="button"
					onClick={handleStop}
					disabled={stopping}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors border border-destructive/30 disabled:opacity-50"
				>
					<Pause className="size-3" />
					{stopping ? "Stopping..." : "Stop"}
				</button>
			</div>

			{/* Chart */}
			<div className="border-b border-border">
				<div ref={chartContainerRef} className="w-full" />
			</div>

			{/* Split region: trades (top) + draggable divider + container
			    log (bottom). Ratios are fraction-based (default 3:7) so
			    the initial layout is resolution-independent. */}
			<div ref={splitContainerRef} className="flex-1 min-h-0 flex flex-col">
				{/* Trade history */}
				<div
					className="min-h-0 overflow-y-auto"
					style={{ flex: `${1 - logFraction} 1 0%` }}
				>
					<div className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
						Trades ({trades.length})
					</div>
					{trades.length === 0 ? (
						<div className="px-4 py-8 text-center text-xs text-muted-foreground">
							{isRunning ? "Waiting for first trade..." : "No trades"}
						</div>
					) : (
						<table className="w-full text-xs">
							<thead>
								<tr className="text-muted-foreground border-b border-border">
									<th className="text-left px-4 py-1.5 font-medium">Pair</th>
									<th className="text-left px-2 py-1.5 font-medium">Side</th>
									<th className="text-right px-2 py-1.5 font-medium">Entry</th>
									<th className="text-right px-2 py-1.5 font-medium">Exit</th>
									<th className="text-right px-4 py-1.5 font-medium">PnL</th>
									<th className="text-right px-4 py-1.5 font-medium">Time</th>
								</tr>
							</thead>
							<tbody>
								{[...trades].reverse().map((t) => (
									<tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
										<td className="px-4 py-1.5 font-mono">{t.pair}</td>
										<td className="px-2 py-1.5">
											<span
												className={cn(
													"inline-flex items-center gap-0.5 font-medium",
													t.side === "long" ? "text-green-500" : "text-red-500",
												)}
											>
												{t.side === "long" ? (
													<ArrowUpRight className="size-3" />
												) : (
													<ArrowDownRight className="size-3" />
												)}
												{t.side.toUpperCase()}
											</span>
										</td>
										<td className="px-2 py-1.5 text-right font-mono">{t.openRate.toFixed(2)}</td>
										<td className="px-2 py-1.5 text-right font-mono">
											{t.closeRate != null ? (
												t.closeRate.toFixed(2)
											) : (
												<span className="text-muted-foreground">open</span>
											)}
										</td>
										<td
											className={cn(
												"px-4 py-1.5 text-right font-mono font-medium",
												t.profitAbs >= 0 ? "text-green-500" : "text-red-500",
											)}
										>
											{t.isOpen ? "—" : formatPnl(t.profitAbs)}
										</td>
										<td className="px-4 py-1.5 text-right text-muted-foreground">
											{formatTime(t.openDate)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>

				{/* Resize handle between trades and log */}
				<div
					onMouseDown={startLogResize}
					className="h-1 shrink-0 cursor-row-resize bg-border hover:bg-blue-500/50 transition-colors"
					title="Drag to resize log panel"
				/>

				{/* Live log console — freqtrade container stdout streamed via
				    paper.log events. Shows "Bot heartbeat" / entry signals /
				    errors so the user can tell a healthy bot from a zombie
				    one without leaving the app. */}
				<div className="min-h-0 flex flex-col" style={{ flex: `${logFraction} 1 0%` }}>
					<div className="flex items-center justify-between px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
						<span className="flex items-center gap-2">
							<span>Container log</span>
							{session?.containerName && (
								<span
									className="text-muted-foreground/60 normal-case tracking-normal font-mono"
									title={session.containerName}
								>
									({session.containerName})
								</span>
							)}
						</span>
						<span className="text-muted-foreground/60 normal-case tracking-normal">
							{logs.length} lines
						</span>
					</div>
					<div
						ref={logContainerRef}
						className="flex-1 overflow-y-auto bg-muted/20 font-mono text-[11px] leading-relaxed px-4 py-2"
					>
						{logs.length === 0 ? (
							<div className="text-muted-foreground/70">
								Waiting for freqtrade output... (bot heartbeat every minute, entry signals when
								strategy triggers)
							</div>
						) : (
							logs.map((l) => {
								// Colour by parsed log level (not by stdout/stderr) —
								// freqtrade writes every level to stderr, so the
								// stream itself is useless as a signal.
								const colour =
									l.level === "error"
										? "text-red-400"
										: l.level === "warning"
											? "text-yellow-400"
											: l.level === "info"
												? "text-green-400"
												: l.level === "debug"
													? "text-muted-foreground/60"
													: "text-foreground/80";
								return (
									<div key={l.id} className={cn("whitespace-pre-wrap break-all", colour)}>
										{l.line}
									</div>
								);
							})
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
