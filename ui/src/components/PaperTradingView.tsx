import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp, ColorType } from "lightweight-charts";
import { ArrowDownRight, ArrowUpRight, Pause } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext.js";
import type { Desk, PaperCandleItem, PaperSession, PaperStatusData, PaperTradeItem } from "../lib/api.js";
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
	const [stopping, setStopping] = useState(false);

	const chartContainerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

	// Derive pair + timeframe from the paper runs row config (set by
	// startPaper from config.json) so we request the right candles.
	const sessionConfig = (session?.meta ?? {}) as Record<string, unknown>;
	const pair = (sessionConfig.pairs as string[] | undefined)?.[0] ?? "BTC/USDT";
	const timeframe = (sessionConfig.timeframe as string) ?? "5m";

	const refresh = useCallback(() => {
		getActivePaperSession(desk.id).then(setSession).catch(() => {});
		getPaperStatus(desk.id).then(setStatus).catch(() => {});
		getPaperTrades(desk.id).then(setTrades).catch(() => {});
		getPaperCandles(desk.id, pair, timeframe).then(setCandles).catch(() => {});
	}, [desk.id, pair, timeframe]);

	useEffect(() => {
		refresh();
		const id = setInterval(refresh, 10000);
		return () => clearInterval(id);
	}, [refresh]);

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
					time: (Math.floor(new Date(t.openDate).getTime() / 1000)) as UTCTimestamp,
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
						<span className="text-xs text-muted-foreground">
							{formatUptime(status.uptime)}
						</span>
					)}
				</div>
				<div className="flex-1" />
				{/* PnL summary */}
				{status && (
					<div className="flex items-center gap-4 text-xs tabular-nums">
						<div>
							<span className="text-muted-foreground mr-1">PnL</span>
							<span className={cn("font-mono font-medium", (status.unrealizedPnl + status.realizedPnl) >= 0 ? "text-green-500" : "text-red-500")}>
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

			{/* Trade history */}
			<div className="flex-1 overflow-y-auto">
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
										<span className={cn(
											"inline-flex items-center gap-0.5 font-medium",
											t.side === "long" ? "text-green-500" : "text-red-500",
										)}>
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
										{t.closeRate != null ? t.closeRate.toFixed(2) : (
											<span className="text-muted-foreground">open</span>
										)}
									</td>
									<td className={cn(
										"px-4 py-1.5 text-right font-mono font-medium",
										t.profitAbs >= 0 ? "text-green-500" : "text-red-500",
									)}>
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
		</div>
	);
}
