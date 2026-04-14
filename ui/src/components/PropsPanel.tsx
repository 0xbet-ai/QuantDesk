import {
	Loader2,
	Pause,
	Play,
	Shield,
	ShieldCheck,
	ShieldX,
	TrendingUp,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveUpdates } from "../context/LiveUpdatesContext.js";
import type { Experiment, PaperSession, PaperStatusData, Run, TradeLogEntry } from "../lib/api.js";
import {
	getActivePaperSession,
	getPaperStatus,
	goPaper,
	listRuns,
	stopPaperSession,
} from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { StatusDot } from "./StatusDot.js";

interface Props {
	experiment: Experiment | null;
	experimentId: string;
	deskId: string;
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center min-h-[36px] text-[13px]">
			<span className="w-[120px] shrink-0 text-muted-foreground">{label}</span>
			<span className="font-medium">{children}</span>
		</div>
	);
}

export function PropsPanel({ experiment, experimentId, deskId }: Props) {
	const { t } = useTranslation();
	const [runs, setRuns] = useState<Run[]>([]);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	// Local "in-flight validation" tracker. Set when the user clicks a
	// shield button, cleared when a `run.status` event arrives carrying a
	// validation payload (published by `submit_rm_verdict`). While set, all
	// other shield buttons are disabled and the active row's icon spins.
	const [validatingRunId, setValidatingRunId] = useState<string | null>(null);

	// Paper trading
	const [paperSession, setPaperSession] = useState<PaperSession | null>(null);
	const [startingPaper, setStartingPaper] = useState(false);
	const [stoppingPaper, setStoppingPaper] = useState(false);
	const [paperError, setPaperError] = useState<string | null>(null);
	const [paperSent, setPaperSent] = useState(false);
	const [paperStatus, setPaperStatus] = useState<PaperStatusData | null>(null);

	// Poll live PnL/position data while paper session is running
	useEffect(() => {
		if (!paperSession || paperSession.status !== "running") {
			setPaperStatus(null);
			return;
		}
		const tick = () => {
			getPaperStatus(deskId)
				.then(setPaperStatus)
				.catch(() => {});
		};
		tick();
		const id = setInterval(tick, 5000);
		return () => clearInterval(id);
	}, [deskId, paperSession?.status]);

	const refreshPaper = useCallback(() => {
		getActivePaperSession(deskId)
			.then(setPaperSession)
			.catch(() => setPaperSession(null));
	}, [deskId]);

	useEffect(() => {
		refreshPaper();
		const id = setInterval(refreshPaper, 5000);
		return () => clearInterval(id);
	}, [refreshPaper]);

	const handleStartPaper = async (runId: string) => {
		setStartingPaper(true);
		setPaperError(null);
		try {
			await goPaper(runId);
			refreshPaper();
		} catch (err) {
			setPaperError(err instanceof Error ? err.message : String(err));
		} finally {
			setStartingPaper(false);
		}
	};

	const handleStopPaper = async () => {
		setStoppingPaper(true);
		try {
			await stopPaperSession(deskId);
			setPaperSession(null);
		} catch (err) {
			console.error("Failed to stop paper:", err);
		} finally {
			setStoppingPaper(false);
		}
	};

	const refreshRuns = useCallback(() => {
		listRuns(experimentId)
			.then(setRuns)
			.catch(() => {});
	}, [experimentId]);

	useEffect(() => {
		refreshRuns();
	}, [refreshRuns]);

	// Live refresh — a backtest finishes via the MCP tool handler on the
	// server and publishes a `run.status` event. Without this, the panel
	// stays frozen on the snapshot fetched at mount and the user has to
	// hard-refresh the page to see a new run.
	useLiveUpdates(experimentId, (event) => {
		if (event.type === "run.status" || event.type === "comment.new") {
			refreshRuns();
			setPaperSent(false);
		}
		// Clear the in-flight validation tracker when the verdict arrives.
		// `submit_rm_verdict` publishes a run.status event with a `validation`
		// payload — that's our signal that the RM finished and the icon for
		// the row can flip from spinner to ShieldCheck/ShieldX.
		if (
			event.type === "run.status" &&
			(event.payload as { validation?: unknown })?.validation != null
		) {
			setValidatingRunId(null);
		}
	});

	// Hide failed/stopped runs from the Properties panel — users care
	// about runs that produced a usable result. `running` is kept so the
	// user sees the live one appear immediately.
	const visibleRuns = runs.filter(
		(r) => r.status !== "failed" && r.status !== "stopped" && r.mode !== "paper",
	);
	const selectedRun = visibleRuns.find((r) => r.id === selectedRunId) ?? null;

	// Trade log rows — flat execution events sorted by time ascending
	// (oldest at top, newest at bottom) and capped so selecting a run
	// with ~10k events doesn't freeze the panel. Memoized per-run so row
	// building doesn't re-run on unrelated re-renders.
	const tradeLog = useMemo(() => {
		type Row = {
			key: string;
			time: string;
			side: "buy" | "sell";
			price: number;
			amount: number;
		};
		const events: TradeLogEntry[] = selectedRun?.result?.trades ?? [];
		if (events.length === 0) {
			return { rows: [] as Row[], totalCount: 0, hiddenCount: 0 };
		}
		const sorted = [...events].sort((a, b) => {
			const ta = a.time ? new Date(a.time).getTime() : 0;
			const tb = b.time ? new Date(b.time).getTime() : 0;
			return ta - tb;
		});
		const DISPLAY_CAP_EVENTS = 1000;
		const hiddenCount = Math.max(0, sorted.length - DISPLAY_CAP_EVENTS);
		const rows: Row[] = [];
		for (let i = hiddenCount; i < sorted.length; i++) {
			const t = sorted[i]!;
			rows.push({
				key: `${i}`,
				time: t.time,
				side: t.side,
				price: t.price,
				amount: t.amount,
			});
		}
		return { rows, totalCount: sorted.length, hiddenCount };
	}, [selectedRun?.id, selectedRun?.result?.trades]);
	// Baseline = first COMPLETED run in runNumber order, not the first
	// attempt. Early failed runs shouldn't become the baseline just
	// because they were the first row in the DB.
	const baseline = visibleRuns.find((r) => r.status === "completed") ?? null;

	return (
		<div className="flex flex-col h-full">
			{/* Scrollable area: experiment info + runs + trade log */}
			<div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-0">
				{/* Experiment properties */}
				{experiment && (
					<>
						<PropRow label={t("propsPanel.status")}>
							<span className="flex items-center gap-1.5">
								<StatusDot status={experiment.status} />
								{experiment.status}
							</span>
						</PropRow>
						<PropRow label={t("propsPanel.runs")}>
							<span className="text-muted-foreground">{visibleRuns.length}</span>
						</PropRow>
					</>
				)}

				{/* Separator */}
				<div className="border-b border-border my-2" />

				{/* Run list */}
				<div>
					<div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
						{t("propsPanel.runsTitle")}
					</div>
					{visibleRuns.length === 0 ? (
						<div className="text-xs text-muted-foreground py-2">{t("propsPanel.noRuns")}</div>
					) : (
						(() => {
							// Use the first run with metrics to determine column headers
							const sampleMetrics = visibleRuns.find((r) => r.result?.metrics?.length)?.result
								?.metrics;
							const col1Label = sampleMetrics?.[0]?.label ?? t("propsPanel.value");
							return (
								<div className="max-h-[280px] overflow-y-auto">
									<table className="w-full text-xs">
										<thead>
											<tr className="text-muted-foreground border-b border-border">
												<th className="text-left py-1.5 font-medium">#</th>
												<th className="text-left py-1.5 font-medium pl-6">{col1Label}</th>
												<th className="text-right py-1.5 font-medium w-20 pr-4">
													{t("propsPanel.validate")}
												</th>
											</tr>
										</thead>
										<tbody>
											{(() => {
												// Find the best run by primary metric (highest return)
												const completedRuns = visibleRuns.filter(
													(r) => r.status === "completed" && r.result?.metrics?.[0]?.value != null,
												);
												const bestRunId =
													completedRuns.length > 0
														? completedRuns.reduce((best, r) =>
																(r.result?.metrics?.[0]?.value ?? Number.NEGATIVE_INFINITY) >
																(best.result?.metrics?.[0]?.value ?? Number.NEGATIVE_INFINITY)
																	? r
																	: best,
															).id
														: null;
												return visibleRuns.map((run) => {
													const m0 = run.result?.metrics?.[0];
													const ret = m0?.value;
													const isBase = baseline?.id === run.id;
													const isBest = run.id === bestRunId && completedRuns.length > 1;
													return (
														<tr
															key={run.id}
															onClick={() =>
																setSelectedRunId((prev) => (prev === run.id ? null : run.id))
															}
															onKeyDown={(e) =>
																e.key === "Enter" &&
																setSelectedRunId((prev) => (prev === run.id ? null : run.id))
															}
															className={cn(
																"group cursor-pointer transition-colors border-b border-border/50",
																run.id === selectedRunId
																	? "bg-accent"
																	: isBest
																		? "bg-green-500/10 hover:bg-green-500/15"
																		: "hover:bg-accent/50",
															)}
														>
															<td className="py-1.5">
																{run.runNumber}
																{isBase && (
																	<span className="ml-1 text-[10px] text-muted-foreground">
																		{t("propsPanel.base")}
																	</span>
																)}
															</td>
															<td className="text-left py-1.5 pl-6">
																{run.status === "running" ? (
																	<span className="flex items-center justify-start gap-1">
																		<StatusDot status="running" />
																		<span className="text-[10px] text-blue-400">
																			{t("propsPanel.running")}
																		</span>
																	</span>
																) : ret != null ? (
																	<span className={ret > 0 ? "text-green-500" : "text-red-500"}>
																		{ret > 0 ? "+" : ""}
																		{ret.toFixed(1)}%
																	</span>
																) : (
																	<span className="text-muted-foreground">&mdash;</span>
																)}
															</td>
															<td className="w-20 text-right pr-4">
																{run.status === "completed" &&
																	(() => {
																		const verdict = (
																			run.result?.validation as { verdict?: string } | undefined
																		)?.verdict;
																		const isValidating = validatingRunId === run.id;
																		const isOtherValidating =
																			validatingRunId !== null && !isValidating;
																		const Icon = isValidating
																			? Loader2
																			: verdict === "approve"
																				? ShieldCheck
																				: verdict === "reject"
																					? ShieldX
																					: Shield;
																		const iconColor = isValidating
																			? "text-blue-500"
																			: verdict === "approve"
																				? "text-green-500"
																				: verdict === "reject"
																					? "text-red-500"
																					: "text-muted-foreground";
																		const tooltip = isValidating
																			? t("propsPanel.tooltipValidating", { num: run.runNumber })
																			: isOtherValidating
																				? t("propsPanel.tooltipWaiting")
																				: verdict === "approve"
																					? t("propsPanel.tooltipApproved")
																					: verdict === "reject"
																						? t("propsPanel.tooltipRejected")
																						: t("propsPanel.tooltipValidate", {
																								num: run.runNumber,
																							});
																		return (
																			<button
																				type="button"
																				disabled={isOtherValidating || isValidating}
																				onClick={(e) => {
																					e.stopPropagation();
																					if (validatingRunId !== null) return;
																					setValidatingRunId(run.id);
																					window.dispatchEvent(
																						new CustomEvent("quantdesk:send-chat", {
																							detail: `Validate Run #${run.runNumber}`,
																						}),
																					);
																				}}
																				title={tooltip}
																				className={cn(
																					"p-0.5 rounded transition-opacity hover:bg-accent disabled:cursor-not-allowed",
																					isValidating
																						? "opacity-100"
																						: isOtherValidating
																							? "opacity-20"
																							: verdict
																								? "opacity-100"
																								: "opacity-40 group-hover:opacity-100",
																					iconColor,
																				)}
																			>
																				<Icon
																					className={cn("size-3.5", isValidating && "animate-spin")}
																				/>
																			</button>
																		);
																	})()}
															</td>
														</tr>
													);
												});
											})()}
										</tbody>
									</table>
								</div>
							);
						})()
					)}
				</div>

				{/* Selected Run Detail */}
				{selectedRun && (
					<>
						<div className="border-b border-border my-2" />
						<div className="space-y-0">
							<div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
								{t("propsPanel.runNumber", { num: selectedRun.runNumber })}
							</div>

							{selectedRun.result?.metrics?.map((m) => {
								const toneClass =
									m.tone === "positive" && m.value > 0
										? "text-green-500"
										: m.tone === "negative"
											? "text-red-500"
											: "";
								const formatted =
									m.format === "percent"
										? `${m.value > 0 && m.tone === "positive" ? "+" : ""}${m.value.toFixed(2)}%`
										: m.format === "integer"
											? Math.round(m.value).toLocaleString()
											: m.format === "currency"
												? `$${m.value.toLocaleString()}`
												: m.value.toFixed(2);
								return (
									<PropRow key={m.key} label={m.label}>
										<span className={toneClass}>{formatted}</span>
									</PropRow>
								);
							})}

							{(() => {
								const runM0 = selectedRun.result?.metrics?.[0];
								const baseM0 = baseline?.result?.metrics?.[0];
								if (!runM0 || !baseM0 || selectedRun.isBaseline) return null;
								const delta = runM0.value - baseM0.value;
								return (
									<div
										className={cn(
											"flex items-center gap-1.5 text-xs mt-2",
											delta > 0
												? "text-green-500"
												: delta < 0
													? "text-red-500"
													: "text-muted-foreground",
										)}
									>
										<TrendingUp className="size-3" />
										{t("propsPanel.vsBaseline")} {delta > 0 ? "+" : ""}
										{runM0.format === "percent" ? `${delta.toFixed(2)}%` : delta.toFixed(2)}
									</div>
								);
							})()}

							{/* Trade Log — flat execution events. Only Time / Side / Price
							    / Amount are fixed; everything else lives in metadata and is
							    surfaced via record_run_metrics. Capped at the last 1000
							    events so runs with 10k+ trades don't freeze the panel. */}
							{tradeLog.totalCount > 0 &&
								(() => {
									const formatTime = (raw: string | undefined) => {
										if (!raw) return "—";
										const d = new Date(raw);
										return Number.isNaN(d.getTime())
											? "—"
											: d.toLocaleDateString("en-US", {
													month: "2-digit",
													day: "2-digit",
													hour: "2-digit",
													minute: "2-digit",
												});
									};
									const formatPrice = (n: number) =>
										n.toLocaleString(undefined, {
											minimumFractionDigits: 0,
											maximumFractionDigits: 6,
										});
									const formatAmount = (n: number) =>
										n.toLocaleString(undefined, {
											minimumFractionDigits: 0,
											maximumFractionDigits: 8,
										});
									return (
										<>
											<div className="border-b border-border my-2" />
											<div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center justify-between gap-2">
												<span>
													{t("propsPanel.tradeLog")} ({tradeLog.totalCount})
												</span>
												{tradeLog.hiddenCount > 0 && (
													<span className="normal-case tracking-normal text-[10px] text-muted-foreground/70 font-normal">
														{t("propsPanel.tradeLogTruncated", {
															hidden: tradeLog.hiddenCount,
														})}
													</span>
												)}
											</div>
											<div className="max-h-64 overflow-y-auto">
												<table className="w-full text-[11px]">
													<thead>
														<tr className="text-muted-foreground">
															<th className="text-left font-medium py-0.5">
																{t("propsPanel.time")}
															</th>
															<th className="text-left font-medium py-0.5">
																{t("propsPanel.side")}
															</th>
															<th className="text-right font-medium py-0.5">
																{t("propsPanel.price")}
															</th>
															<th className="text-right font-medium py-0.5">
																{t("propsPanel.amount")}
															</th>
														</tr>
													</thead>
													<tbody>
														{tradeLog.rows.map((r) => (
															<tr key={r.key} className="border-t border-border/30">
																<td className="py-0.5 text-muted-foreground">
																	{formatTime(r.time)}
																</td>
																<td
																	className={cn(
																		"py-0.5 font-medium",
																		r.side === "buy"
																			? "text-green-600 dark:text-green-400"
																			: "text-red-500",
																	)}
																>
																	{r.side.toUpperCase()}
																</td>
																<td className="py-0.5 text-right font-mono text-foreground/80">
																	{formatPrice(r.price)}
																</td>
																<td className="py-0.5 text-right font-mono text-foreground/80">
																	{formatAmount(r.amount)}
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</>
									);
								})()}
						</div>
					</>
				)}
			</div>
			{/* end scrollable area */}

			{/* Paper Trading section — pinned to bottom */}
			{(() => {
				const isActive =
					paperSession && (paperSession.status === "running" || paperSession.status === "pending");
				const isFailed = paperSession && paperSession.status === "failed";
				const completedRuns = runs.filter(
					(r) =>
						r.mode === "backtest" &&
						r.status === "completed" &&
						r.result?.metrics?.[0]?.value != null,
				);
				const bestRun =
					completedRuns.length > 0
						? completedRuns.reduce((best, r) =>
								(r.result?.metrics?.[0]?.value ?? Number.NEGATIVE_INFINITY) >
								(best.result?.metrics?.[0]?.value ?? Number.NEGATIVE_INFINITY)
									? r
									: best,
							)
						: null;

				if (!isActive && !isFailed && !bestRun) return null;

				return (
					<div className="shrink-0 border-t border-border px-4 py-3">
						<div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
							{t("propsPanel.paperTrading")}
						</div>
						{isActive ? (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<span className="relative flex h-2 w-2">
										<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-70" />
										<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
									</span>
									<span className="text-xs font-medium text-green-600 dark:text-green-400">
										{paperSession.status === "pending"
											? t("propsPanel.starting")
											: t("propsPanel.running")}
									</span>
									{paperStatus && (
										<span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
											{formatUptime(paperStatus.uptime)}
										</span>
									)}
								</div>
								{paperStatus && paperSession.status === "running" && (
									<div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] tabular-nums">
										<div>
											<div className="text-muted-foreground">{t("propsPanel.unrealized")}</div>
											<div
												className={cn(
													"font-mono font-medium",
													paperStatus.unrealizedPnl >= 0 ? "text-green-500" : "text-red-500",
												)}
											>
												{paperStatus.unrealizedPnl >= 0 ? "+" : ""}
												{paperStatus.unrealizedPnl.toFixed(2)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">{t("propsPanel.realized")}</div>
											<div
												className={cn(
													"font-mono font-medium",
													paperStatus.realizedPnl >= 0 ? "text-green-500" : "text-red-500",
												)}
											>
												{paperStatus.realizedPnl >= 0 ? "+" : ""}
												{paperStatus.realizedPnl.toFixed(2)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">{t("propsPanel.positions")}</div>
											<div className="font-mono font-medium">{paperStatus.openPositions}</div>
										</div>
										<div>
											<div className="text-muted-foreground">{t("propsPanel.totalPnl")}</div>
											<div
												className={cn(
													"font-mono font-medium",
													paperStatus.unrealizedPnl + paperStatus.realizedPnl >= 0
														? "text-green-500"
														: "text-red-500",
												)}
											>
												{paperStatus.unrealizedPnl + paperStatus.realizedPnl >= 0 ? "+" : ""}
												{(paperStatus.unrealizedPnl + paperStatus.realizedPnl).toFixed(2)}
											</div>
										</div>
									</div>
								)}
								<div className="text-[10px] text-muted-foreground">
									{t("propsPanel.started")}{" "}
									{new Date(paperSession.startedAt).toLocaleString("en-US", {
										month: "short",
										day: "numeric",
										hour: "2-digit",
										minute: "2-digit",
									})}
								</div>
								<button
									type="button"
									onClick={handleStopPaper}
									disabled={stoppingPaper}
									className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
								>
									<Pause className="size-3" />
									{stoppingPaper ? t("propsPanel.stopping") : t("common.stop")}
								</button>
							</div>
						) : isFailed ? (
							<div className="space-y-1">
								<div className="flex items-center gap-2">
									<span className="h-2 w-2 rounded-full bg-destructive" />
									<span className="text-xs font-medium text-destructive">
										{t("propsPanel.failed")}
									</span>
								</div>
								<div
									className="text-[10px] text-muted-foreground truncate"
									title={paperSession.error ?? undefined}
								>
									{paperSession.error ?? t("propsPanel.unknownError")}
								</div>
							</div>
						) : bestRun ? (
							(() => {
								const verdict = bestRun.result?.validation?.verdict;
								const isApproved = verdict === "approve";
								const isRejected = verdict === "reject";
								const sendPaper = () => {
									setPaperSent(true);
									window.dispatchEvent(
										new CustomEvent("quantdesk:send-chat", {
											detail: `Run paper trading with #${bestRun.runNumber}`,
										}),
									);
								};
								const startRejectedWithConfirm = () => {
									const reason = (bestRun.result?.validation as { reason?: string } | undefined)
										?.reason;
									const msg =
										t("propsPanel.confirmRejectedPaper", { num: bestRun.runNumber }) +
										(reason ? `:\n\n${reason}\n\n` : ".\n\n") +
										"Start paper trading anyway?";
									if (window.confirm(msg)) {
										handleStartPaper(bestRun.id);
									}
								};
								return (
									<button
										type="button"
										onClick={
											isApproved
												? () => handleStartPaper(bestRun.id)
												: isRejected
													? startRejectedWithConfirm
													: sendPaper
										}
										disabled={startingPaper || paperSent}
										title={
											isApproved
												? t("propsPanel.tooltipStartPaper")
												: isRejected
													? t("propsPanel.tooltipRejectedStart")
													: t("propsPanel.tooltipDiscussPaper")
										}
										className={cn(
											"flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md transition-colors",
											isRejected ? "hover:bg-red-500/10" : "hover:bg-green-500/10",
										)}
									>
										{isRejected ? (
											<div className="flex size-6 items-center justify-center rounded-md bg-red-500/10">
												<XCircle className="size-3 text-red-400" />
											</div>
										) : (
											<div className="flex size-6 items-center justify-center rounded-md bg-green-500/15">
												<Play className="size-3 text-green-500" />
											</div>
										)}
										<div className="text-left">
											<div className="text-xs font-medium">
												{t("propsPanel.runNumber", { num: bestRun.runNumber })}
											</div>
											<div className="text-[10px] text-muted-foreground">
												{startingPaper
													? t("propsPanel.starting")
													: isApproved
														? t("propsPanel.ready")
														: isRejected
															? t("propsPanel.rejectedStartAnyway")
															: t("propsPanel.paperTrade")}
											</div>
										</div>
									</button>
								);
							})()
						) : null}
						{paperError && (
							<div className="text-[10px] text-red-500 truncate mt-1" title={paperError}>
								{paperError}
							</div>
						)}
					</div>
				);
			})()}
		</div>
	);
}

function formatUptime(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const min = Math.floor(seconds / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ${min % 60}m`;
	const day = Math.floor(hr / 24);
	return `${day}d ${hr % 24}h`;
}
