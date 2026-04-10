import { Pause, Play, TrendingUp, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLiveUpdates } from "../context/LiveUpdatesContext.js";
import type { Experiment, PaperSession, PaperStatusData, Run } from "../lib/api.js";
import { getActivePaperSession, getPaperStatus, goPaper, listRuns, stopPaperSession } from "../lib/api.js";
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
	const [runs, setRuns] = useState<Run[]>([]);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

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
			getPaperStatus(deskId).then(setPaperStatus).catch(() => {});
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
	});

	// Hide failed/stopped runs from the Properties panel — users care
	// about runs that produced a usable result. `running` is kept so the
	// user sees the live one appear immediately.
	const visibleRuns = runs.filter((r) => r.status !== "failed" && r.status !== "stopped" && r.mode !== "paper");
	const selectedRun = visibleRuns.find((r) => r.id === selectedRunId) ?? null;
	// Baseline = first COMPLETED run in runNumber order, not the first
	// attempt. Early failed runs shouldn't become the baseline just
	// because they were the first row in the DB.
	const baseline = visibleRuns.find((r) => r.status === "completed") ?? null;

	return (
		<div className="px-4 py-3 space-y-0">
			{/* Experiment properties */}
			{experiment && (
				<>
					<PropRow label="Status">
						<span className="flex items-center gap-1.5">
							<StatusDot status={experiment.status} />
							{experiment.status}
						</span>
					</PropRow>
					<PropRow label="Runs">
						<span className="text-muted-foreground">{visibleRuns.length}</span>
					</PropRow>
				</>
			)}

			{/* Separator */}
			<div className="border-b border-border my-2" />

			{/* Run list */}
			<div>
				<div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
					Runs
				</div>
				{visibleRuns.length === 0 ? (
					<div className="text-xs text-muted-foreground py-2">No runs yet</div>
				) : (
					(() => {
						// Use the first run with metrics to determine column headers
						const sampleMetrics = visibleRuns.find((r) => r.result?.metrics?.length)?.result
							?.metrics;
						const col1Label = sampleMetrics?.[0]?.label ?? "Value";
						const col2Label = sampleMetrics?.[1]?.label;
						return (
							<div className="max-h-[280px] overflow-y-auto">
							<table className="w-full text-xs">
								<thead>
									<tr className="text-muted-foreground border-b border-border">
										<th className="text-left py-1.5 font-medium">#</th>
										<th className="text-right py-1.5 font-medium">{col1Label}</th>
										{col2Label && <th className="text-right py-1.5 font-medium">{col2Label}</th>}
										<th className="w-7" />
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
													(r.result?.metrics?.[0]?.value ?? -Infinity) >
													(best.result?.metrics?.[0]?.value ?? -Infinity)
														? r
														: best,
												).id
											: null;
									return visibleRuns.map((run) => {
										const m0 = run.result?.metrics?.[0];
										const m1 = run.result?.metrics?.[1];
										const ret = m0?.value;
										const dd = m1?.value;
										const baselineM0 = baseline?.result?.metrics?.[0];
										const isBase = baseline?.id === run.id;
										const isBest = run.id === bestRunId && completedRuns.length > 1;
										const delta =
											!isBase && baselineM0 && m0 ? m0.value - baselineM0.value : null;
										return (
											<tr
												key={run.id}
												onClick={() => setSelectedRunId((prev) => prev === run.id ? null : run.id)}
												onKeyDown={(e) => e.key === "Enter" && setSelectedRunId((prev) => prev === run.id ? null : run.id)}
												className={cn(
													"cursor-pointer transition-colors border-b border-border/50",
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
														<span className="ml-1 text-[10px] text-muted-foreground">base</span>
													)}
												</td>
												<td className="text-right py-1.5">
													{run.status === "running" ? (
														<span className="flex items-center justify-end gap-1">
															<StatusDot status="running" />
															<span className="text-[10px] text-blue-400">running</span>
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
												{col2Label && (
													<td className="text-right py-1.5">
														{dd != null ? (
															<span className={m1?.tone === "negative" ? "text-red-500" : ""}>
																{m1?.format === "percent" ? `${dd.toFixed(1)}%` : dd.toFixed(1)}
															</span>
														) : (
															<span className="text-muted-foreground">&mdash;</span>
														)}
														{delta != null && (
															<span
																className={cn(
																	"ml-1 text-[10px]",
																	delta > 0 ? "text-green-500" : "text-red-500",
																)}
															>
																({delta > 0 ? "+" : ""}
																{delta.toFixed(1)})
															</span>
														)}
													</td>
												)}
												<td className="w-7" />
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
							Run #{selectedRun.runNumber}
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
									vs baseline {delta > 0 ? "+" : ""}
									{runM0.format === "percent" ? `${delta.toFixed(2)}%` : delta.toFixed(2)}
								</div>
							);
						})()}

					</div>
				</>
			)}

			{/* Paper Trading section */}
			{(() => {
				const isActive = paperSession && (paperSession.status === "running" || paperSession.status === "pending");
				const isFailed = paperSession && paperSession.status === "failed";
				const completedRuns = runs.filter((r) => r.mode === "backtest" && r.status === "completed" && r.result?.metrics?.[0]?.value != null);
				const bestRun = completedRuns.length > 0
					? completedRuns.reduce((best, r) =>
						(r.result?.metrics?.[0]?.value ?? -Infinity) > (best.result?.metrics?.[0]?.value ?? -Infinity) ? r : best)
					: null;

				if (!isActive && !isFailed && !bestRun) return null;

				return (
					<>
						<div className="border-b border-border my-2" />
						<div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
							Paper Trading
						</div>
						{isActive ? (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<span className="relative flex h-2 w-2">
										<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-70" />
										<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
									</span>
									<span className="text-xs font-medium text-green-600 dark:text-green-400">
										{paperSession.status === "pending" ? "Starting…" : "Running"}
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
											<div className="text-muted-foreground">Unrealized</div>
											<div className={cn("font-mono font-medium", paperStatus.unrealizedPnl >= 0 ? "text-green-500" : "text-red-500")}>
												{paperStatus.unrealizedPnl >= 0 ? "+" : ""}{paperStatus.unrealizedPnl.toFixed(2)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">Realized</div>
											<div className={cn("font-mono font-medium", paperStatus.realizedPnl >= 0 ? "text-green-500" : "text-red-500")}>
												{paperStatus.realizedPnl >= 0 ? "+" : ""}{paperStatus.realizedPnl.toFixed(2)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">Positions</div>
											<div className="font-mono font-medium">{paperStatus.openPositions}</div>
										</div>
										<div>
											<div className="text-muted-foreground">Total PnL</div>
											<div className={cn("font-mono font-medium", (paperStatus.unrealizedPnl + paperStatus.realizedPnl) >= 0 ? "text-green-500" : "text-red-500")}>
												{(paperStatus.unrealizedPnl + paperStatus.realizedPnl) >= 0 ? "+" : ""}{(paperStatus.unrealizedPnl + paperStatus.realizedPnl).toFixed(2)}
											</div>
										</div>
									</div>
								)}
								<div className="text-[10px] text-muted-foreground">
									Started {new Date(paperSession.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
								</div>
								<button
									type="button"
									onClick={handleStopPaper}
									disabled={stoppingPaper}
									className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
								>
									<Pause className="size-3" />
									{stoppingPaper ? "Stopping…" : "Stop"}
								</button>
							</div>
						) : isFailed ? (
							<div className="space-y-1">
								<div className="flex items-center gap-2">
									<span className="h-2 w-2 rounded-full bg-destructive" />
									<span className="text-xs font-medium text-destructive">Failed</span>
								</div>
								<div className="text-[10px] text-muted-foreground truncate" title={paperSession.error ?? undefined}>
									{paperSession.error ?? "Unknown error"}
								</div>
							</div>
						) : bestRun ? (() => {
							const verdict = bestRun.result?.validation?.verdict;
							const isApproved = verdict === "approve";
							const sendPaper = () => {
								setPaperSent(true);
								window.dispatchEvent(
									new CustomEvent("quantdesk:send-chat", {
										detail: `Run paper trading with #${bestRun.runNumber}`,
									}),
								);
							};
							return (
								<button
									type="button"
									onClick={
										isApproved
											? () => handleStartPaper(bestRun.id)
											: verdict === "reject"
												? undefined
												: sendPaper
									}
									disabled={startingPaper || verdict === "reject" || paperSent}
									title={isApproved ? "Start paper trading" : verdict === "reject" ? "Rejected" : "Discuss paper trading with agent"}
									className={cn(
										"flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md transition-colors",
										isApproved ? "hover:bg-green-500/10" : verdict === "reject" ? "opacity-50" : "hover:bg-green-500/10",
									)}
								>
									{verdict === "reject" ? (
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
											Run #{bestRun.runNumber}
										</div>
										<div className="text-[10px] text-muted-foreground">
											{startingPaper ? "Starting…" : isApproved ? "Ready" : verdict === "reject" ? "Rejected" : "Paper Trade"}
										</div>
									</div>
								</button>
							);
						})() : null}
						{paperError && (
							<div className="text-[10px] text-red-500 truncate mt-1" title={paperError}>{paperError}</div>
						)}
					</>
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
