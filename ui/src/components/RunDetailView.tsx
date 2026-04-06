import { ArrowLeft, GitCommit, Play, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { Experiment, Run } from "../lib/api.js";
import { goLive, listRuns } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { StatusBadge } from "./StatusBadge.js";
import { Button } from "./ui/button.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { Separator } from "./ui/separator.js";

interface RunDetailViewProps {
	experiment: Experiment;
	selectedRunId: string | null;
	onBack: () => void;
}

function relativeTime(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (seconds < 60) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDuration(start: string, end: string): string {
	const sec = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
	if (sec <= 0) return "<1s";
	if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
	return `${sec}s`;
}

/** Safely format win rate — handle both 0-1 (ratio) and 0-100 (percent) inputs */
function formatWinRate(winRate: number): string {
	// If value is > 1, it's already a percentage
	if (winRate > 1) return `${winRate.toFixed(0)}%`;
	return `${(winRate * 100).toFixed(0)}%`;
}

function RunListItem({
	run,
	isSelected,
	onClick,
}: { run: Run; isSelected: boolean; onClick: () => void }) {
	const ret = run.result?.returnPct;
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex items-center justify-between w-full px-3 py-2.5 text-left border-b border-border/50 transition-colors",
				isSelected ? "bg-accent" : "hover:bg-accent/50",
			)}
		>
			<div className="flex items-center gap-2 min-w-0">
				<span className="text-xs font-mono text-muted-foreground w-6 shrink-0">
					#{run.runNumber}
				</span>
				<StatusBadge status={run.status} />
				{run.isBaseline && (
					<span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5 shrink-0">
						base
					</span>
				)}
			</div>
			<div className="text-xs font-mono tabular-nums shrink-0 ml-2">
				{run.status === "running" ? (
					<span className="text-cyan-500">live</span>
				) : ret != null ? (
					<span className={ret > 0 ? "text-green-500" : "text-red-500"}>
						{ret > 0 ? "+" : ""}
						{ret.toFixed(1)}%
					</span>
				) : (
					<span className="text-muted-foreground">&mdash;</span>
				)}
			</div>
		</button>
	);
}

function RunDetail({
	run,
	baseline,
	onGoLive,
}: { run: Run; baseline: Run | null; onGoLive: (id: string) => void }) {
	const hasResult = !!run.result;
	const hasDuration =
		run.completedAt && new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime() > 0;

	return (
		<div className="space-y-4 min-w-0">
			{/* Run summary card */}
			<div className="border border-border rounded-lg overflow-hidden">
				{/* Header row */}
				<div className="p-4 space-y-3">
					<div className="flex items-center gap-2 flex-wrap">
						<StatusBadge status={run.status} />
						<span className="text-xs font-mono text-muted-foreground">Run #{run.runNumber}</span>
						{run.isBaseline && (
							<span className="text-[10px] bg-muted rounded px-1.5 py-0.5 font-medium text-muted-foreground">
								baseline
							</span>
						)}
						<span className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{run.mode}
						</span>
					</div>

					{/* Timing */}
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>{relativeTime(run.createdAt)}</span>
						{hasDuration && (
							<>
								<span className="text-border">|</span>
								<span>Duration: {formatDuration(run.createdAt, run.completedAt!)}</span>
							</>
						)}
					</div>

					{/* Commit hash */}
					{run.commitHash && (
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<GitCommit className="h-3 w-3" />
							<span className="font-mono">{run.commitHash.slice(0, 8)}</span>
						</div>
					)}

					{/* Error */}
					{run.error && <div className="text-xs text-red-600 dark:text-red-400">{run.error}</div>}
				</div>

				{/* Metrics */}
				{hasResult && (
					<div className="border-t border-border p-4">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 tabular-nums">
							<div>
								<div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
									Return
								</div>
								<div
									className={cn(
										"text-lg font-semibold font-mono",
										run.result!.returnPct > 0 ? "text-green-500" : "text-red-500",
									)}
								>
									{run.result!.returnPct > 0 ? "+" : ""}
									{run.result!.returnPct.toFixed(2)}%
								</div>
							</div>
							<div>
								<div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
									Drawdown
								</div>
								<div className="text-lg font-semibold font-mono text-red-500">
									{run.result!.drawdownPct.toFixed(2)}%
								</div>
							</div>
							<div>
								<div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
									Win Rate
								</div>
								<div className="text-lg font-semibold font-mono">
									{formatWinRate(run.result!.winRate)}
								</div>
							</div>
							<div>
								<div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
									Trades
								</div>
								<div className="text-lg font-semibold font-mono">{run.result!.totalTrades}</div>
							</div>
						</div>
					</div>
				)}

				{/* Delta vs baseline */}
				{baseline?.result && run.result && !run.isBaseline && (
					<div className="border-t border-border px-4 py-2.5">
						<div className="flex items-center gap-1.5 text-xs">
							<TrendingUp className="h-3 w-3 text-green-500" />
							<span className="text-muted-foreground">vs baseline</span>
							<span
								className={cn(
									"font-mono font-medium",
									run.result.returnPct - baseline.result.returnPct > 0
										? "text-green-500"
										: "text-red-500",
								)}
							>
								{run.result.returnPct - baseline.result.returnPct > 0 ? "+" : ""}
								{(run.result.returnPct - baseline.result.returnPct).toFixed(2)}%
							</span>
						</div>
					</div>
				)}
			</div>

			{/* Go Live button */}
			{run.mode === "backtest" && run.status === "completed" && (
				<Button className="w-full bg-green-600 hover:bg-green-500" onClick={() => onGoLive(run.id)}>
					<Play className="size-4 mr-2" />
					Go Live
				</Button>
			)}
		</div>
	);
}

export function RunDetailView({ experiment, selectedRunId, onBack }: RunDetailViewProps) {
	const [runs, setRuns] = useState<Run[]>([]);
	const [loading, setLoading] = useState(true);
	const [activeRunId, setActiveRunId] = useState<string | null>(selectedRunId);

	useEffect(() => {
		setLoading(true);
		listRuns(experiment.id)
			.then((data) => {
				setRuns(data);
				if (!activeRunId && data.length > 0) {
					setActiveRunId(data[data.length - 1]!.id);
				}
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [experiment.id, activeRunId]);

	const sorted = [...runs].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
	const selectedRun = sorted.find((r) => r.id === activeRunId) ?? null;
	const baseline = sorted.find((r) => r.isBaseline) ?? null;

	const handleGoLive = async (runId: string) => {
		try {
			await goLive(runId);
		} catch (err) {
			console.error(err);
		}
	};

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="px-4 h-12 flex items-center gap-2 shrink-0">
				<button
					type="button"
					onClick={onBack}
					className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Back
				</button>
				<Separator orientation="vertical" className="h-4" />
				<span className="text-[13px] font-semibold">Experiment #{experiment.number}</span>
				<span className="text-[13px] text-muted-foreground">— Runs</span>
			</div>
			<Separator />

			{/* Content */}
			{loading ? (
				<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
					Loading...
				</div>
			) : runs.length === 0 ? (
				<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
					No runs yet
				</div>
			) : (
				<div className="flex flex-1 min-h-0">
					{/* Left: run list */}
					<div
						className={cn(
							"shrink-0 border-r border-border overflow-y-auto",
							selectedRun ? "w-56" : "w-full",
						)}
					>
						{sorted.map((run) => (
							<RunListItem
								key={run.id}
								run={run}
								isSelected={run.id === activeRunId}
								onClick={() => setActiveRunId(run.id)}
							/>
						))}
					</div>

					{/* Right: run detail */}
					{selectedRun && (
						<ScrollArea className="flex-1 min-w-0">
							<div className="p-4">
								<RunDetail run={selectedRun} baseline={baseline} onGoLive={handleGoLive} />
							</div>
						</ScrollArea>
					)}
				</div>
			)}
		</div>
	);
}
