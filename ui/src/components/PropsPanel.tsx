import { Play, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { Experiment, Run } from "../lib/api.js";
import { goLive, listRuns } from "../lib/api.js";
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

	useEffect(() => {
		listRuns(experimentId)
			.then(setRuns)
			.catch(() => {});
	}, [experimentId]);

	const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
	const baseline = runs.find((r) => r.isBaseline) ?? null;

	const handleGoLive = async (runId: string) => {
		try {
			await goLive(runId);
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
						<span className="text-muted-foreground">{runs.length}</span>
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
				{runs.length === 0 ? (
					<div className="text-xs text-muted-foreground py-2">No runs yet</div>
				) : (
					<table className="w-full text-xs">
						<thead>
							<tr className="text-muted-foreground border-b border-border">
								<th className="text-left py-1.5 font-medium">#</th>
								<th className="text-right py-1.5 font-medium">Return</th>
								<th className="text-right py-1.5 font-medium">DD</th>
							</tr>
						</thead>
						<tbody>
							{runs.map((run) => {
								const m0 = run.result?.metrics?.[0];
								const m1 = run.result?.metrics?.[1];
								const ret = m0?.value;
								const dd = m1?.value;
								const baselineM0 = baseline?.result?.metrics?.[0];
								const delta =
									!run.isBaseline && baselineM0 && m0 ? m0.value - baselineM0.value : null;
								return (
									<tr
										key={run.id}
										onClick={() => setSelectedRunId(run.id)}
										onKeyDown={(e) => e.key === "Enter" && setSelectedRunId(run.id)}
										className={cn(
											"cursor-pointer transition-colors border-b border-border/50",
											run.id === selectedRunId ? "bg-accent" : "hover:bg-accent/50",
										)}
									>
										<td className="py-1.5">
											{run.runNumber}
											{run.isBaseline && (
												<span className="ml-1 text-[10px] text-muted-foreground">base</span>
											)}
										</td>
										<td className="text-right py-1.5">
											{run.status === "running" ? (
												<span className="flex items-center justify-end gap-1">
													<StatusDot status="running" />
													<span className="text-[10px] text-blue-400">live</span>
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
										<td className="text-right py-1.5">
											{dd != null ? (
												<span className="text-red-500">{dd.toFixed(1)}%</span>
											) : (
												<span className="text-muted-foreground">&mdash;</span>
											)}
											{delta != null && (
												<span className="text-green-500 ml-1 text-[10px]">
													({delta > 0 ? "+" : ""}
													{delta.toFixed(1)})
												</span>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
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

						{selectedRun.result?.metrics.map((m) => {
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
								onClick={() => handleGoLive(selectedRun.id)}
							>
								<Play className="size-4" />
								Go Live
							</Button>
						)}
					</div>
				</>
			)}
		</div>
	);
}
