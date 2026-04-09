import { Play, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLiveUpdates } from "../context/LiveUpdatesContext.js";
import type { Experiment, Run } from "../lib/api.js";
import { goPaper, listRuns } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { StatusDot } from "./StatusDot.js";
import { Button } from "./ui/button.js";

interface Props {
	experiment: Experiment | null;
	experimentId: string;
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center min-h-[36px] text-[13px]">
			<span className="w-[120px] shrink-0 text-muted-foreground">{label}</span>
			<span className="font-medium">{children}</span>
		</div>
	);
}

export function PropsPanel({ experiment, experimentId }: Props) {
	const [runs, setRuns] = useState<Run[]>([]);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

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
		}
	});

	// Hide failed/stopped runs from the Properties panel — users care
	// about runs that produced a usable result. `running` is kept so the
	// user sees the live one appear immediately.
	const visibleRuns = runs.filter((r) => r.status !== "failed" && r.status !== "stopped");
	const selectedRun = visibleRuns.find((r) => r.id === selectedRunId) ?? null;
	// Baseline = first COMPLETED run in runNumber order, not the first
	// attempt. Early failed runs shouldn't become the baseline just
	// because they were the first row in the DB.
	const baseline = visibleRuns.find((r) => r.status === "completed") ?? null;

	const handleGoPaper = async (runId: string) => {
		try {
			await goPaper(runId);
		} catch (err) {
			console.error(err);
		}
	};

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
												onClick={() => setSelectedRunId(run.id)}
												onKeyDown={(e) => e.key === "Enter" && setSelectedRunId(run.id)}
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

						{selectedRun.mode === "backtest" && selectedRun.status === "completed" && (
							<Button
								size="sm"
								className="w-full mt-3 bg-green-600 hover:bg-green-500"
								onClick={() => handleGoPaper(selectedRun.id)}
							>
								<Play className="size-4" />
								Start Paper Trading
							</Button>
						)}
					</div>
				</>
			)}
		</div>
	);
}
