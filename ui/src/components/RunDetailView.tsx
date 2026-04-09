import { ArrowLeft, CheckCircle2, GitCommit, Play, Shield, TrendingUp, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Experiment, Run } from "../lib/api.js";
import { getAgentLogs, goPaper, listRuns } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { StatusBadge } from "./StatusBadge.js";
import type { TranscriptEntry } from "./transcript/RunTranscriptView.js";
import { RunTranscriptView } from "./transcript/RunTranscriptView.js";
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

function formatMetricValue(value: number, format: string): string {
	if (format === "percent") return `${value.toFixed(2)}%`;
	if (format === "integer") return Math.round(value).toLocaleString();
	if (format === "currency") return `$${value.toLocaleString()}`;
	return value.toFixed(2);
}

/** Get the primary numeric value from a run — uses the first metric (convention) */
function primaryValue(run: Run): number | null {
	const m = run.result?.metrics?.[0];
	return m?.value ?? null;
}

function RunListItem({
	run,
	isBaseline,
	isSelected,
	onClick,
}: { run: Run; isBaseline: boolean; isSelected: boolean; onClick: () => void }) {
	const ret = primaryValue(run);
	const retFormat = run.result?.metrics?.[0]?.format ?? "number";
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
				{isBaseline && (
					<span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5 shrink-0">
						base
					</span>
				)}
				{run.result?.validation?.verdict === "approve" && (
					<CheckCircle2 className="size-3 text-green-500 shrink-0" />
				)}
				{run.result?.validation?.verdict === "reject" && (
					<XCircle className="size-3 text-red-500 shrink-0" />
				)}
			</div>
			<div className="text-xs font-mono tabular-nums shrink-0 ml-2">
				{run.status === "running" ? (
					<span className="text-cyan-500">running</span>
				) : ret != null ? (
					<span
						className={
							ret > 0 ? "text-green-500" : ret < 0 ? "text-red-500" : "text-muted-foreground"
						}
					>
						{retFormat === "percent" && ret > 0 ? "+" : ""}
						{formatMetricValue(ret, retFormat)}
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
	onGoPaper,
	paperStarting,
	paperError,
	transcriptEntries,
}: {
	run: Run;
	baseline: Run | null;
	onGoPaper: (id: string) => void;
	paperStarting: boolean;
	paperError: string | null;
	transcriptEntries: TranscriptEntry[];
}) {
	const hasResult = !!run.result;
	const hasDuration =
		run.completedAt && new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime() > 0;

	return (
		<div className="space-y-4 min-w-0">
			{/* Run summary card */}
			<div className="border border-border rounded-lg overflow-hidden shadow-sm">
				{/* Header row */}
				<div className="p-4 space-y-3">
					<div className="flex items-center gap-2 flex-wrap">
						<StatusBadge status={run.status} />
						<span className="text-xs font-mono text-muted-foreground">Run #{run.runNumber}</span>
						{baseline?.id === run.id && (
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
				{hasResult && Array.isArray(run.result?.metrics) && run.result!.metrics.length > 0 && (
					<div className="border-t border-border p-4">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 tabular-nums">
							{run.result!.metrics.map((m) => {
								const toneClass =
									m.tone === "positive" && m.value > 0
										? "text-green-500"
										: m.tone === "negative"
											? "text-red-500"
											: m.tone === "positive" && m.value < 0
												? "text-red-500"
												: "text-foreground";
								return (
									<div key={m.key}>
										<div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
											{m.label}
										</div>
										<div className={cn("text-lg font-semibold font-mono", toneClass)}>
											{m.format === "percent" && m.tone === "positive" && m.value > 0 ? "+" : ""}
											{formatMetricValue(m.value, m.format)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}

				{/* Delta vs baseline — compare primary metric */}
				{(() => {
					const runPrimary = primaryValue(run);
					const basePrimary = baseline ? primaryValue(baseline) : null;
					if (baseline == null || runPrimary == null || basePrimary == null || baseline.id === run.id)
						return null;
					const delta = runPrimary - basePrimary;
					const primaryLabel = run.result?.metrics?.[0]?.label ?? "value";
					const primaryFormat = run.result?.metrics?.[0]?.format ?? "number";
					return (
						<div className="border-t border-border px-4 py-2.5">
							<div className="flex items-center gap-1.5 text-xs">
								<TrendingUp className="h-3 w-3 text-green-500" />
								<span className="text-muted-foreground">vs baseline ({primaryLabel})</span>
								<span
									className={cn(
										"font-mono font-medium",
										delta > 0
											? "text-green-500"
											: delta < 0
												? "text-red-500"
												: "text-muted-foreground",
									)}
								>
									{delta > 0 ? "+" : ""}
									{formatMetricValue(delta, primaryFormat)}
								</span>
							</div>
						</div>
					);
				})()}
			</div>

			{/* Validation + Paper Trading */}
			{run.mode === "backtest" && run.status === "completed" && (() => {
				const validation = run.result?.validation;
				const isApproved = validation?.verdict === "approve";

				return (
					<div className="space-y-2">
						{/* Validation badge */}
						{validation ? (
							<div
								className={cn(
									"flex items-center gap-2 px-3 py-2 rounded-md border text-xs",
									isApproved
										? "border-green-500/30 bg-green-500/[0.06] text-green-700 dark:text-green-300"
										: "border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-300",
								)}
							>
								{isApproved ? (
									<CheckCircle2 className="size-3.5 shrink-0" />
								) : (
									<XCircle className="size-3.5 shrink-0" />
								)}
								<span className="font-medium">
									Risk Manager: {isApproved ? "Approved" : "Rejected"}
								</span>
								{validation.reason && (
									<span className="text-muted-foreground ml-1 truncate">
										— {validation.reason}
									</span>
								)}
							</div>
						) : (
							<div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
								<Shield className="size-3.5 shrink-0" />
								<span>Not validated yet — request validation from the agent to enable paper trading</span>
							</div>
						)}

						{/* Paper Trading button */}
						{isApproved && (
							<>
								<Button
									className="w-full bg-green-600 hover:bg-green-500"
									onClick={() => onGoPaper(run.id)}
									disabled={paperStarting}
								>
									<Play className="size-4 mr-2" />
									{paperStarting ? "Starting…" : "Start Paper Trading"}
								</Button>
								{paperError && (
									<div className="text-xs text-red-600 dark:text-red-400 px-1">
										{paperError}
									</div>
								)}
							</>
						)}
					</div>
				);
			})()}

			{/* Agent transcript */}
			{transcriptEntries.length > 0 && (
				<div className="border border-border rounded-lg overflow-hidden shadow-sm">
					<div className="px-4 py-2.5 border-b border-border bg-muted/30">
						<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
							Agent Transcript
						</span>
					</div>
					<div className="p-3">
						<RunTranscriptView
							entries={transcriptEntries}
							density="compact"
							streaming={false}
							emptyMessage="No transcript available."
						/>
					</div>
				</div>
			)}
		</div>
	);
}

export function RunDetailView({ experiment, selectedRunId, onBack }: RunDetailViewProps) {
	const navigate = useNavigate();
	const [runs, setRuns] = useState<Run[]>([]);
	const [loading, setLoading] = useState(true);
	const [activeRunId, setActiveRunId] = useState<string | null>(selectedRunId);
	const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);

	// Sync from URL
	useEffect(() => {
		setActiveRunId(selectedRunId);
	}, [selectedRunId]);

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

	const selectRun = (id: string) => {
		setActiveRunId(id);
		navigate(`/desks/${experiment.deskId}/experiments/${experiment.id}/runs/${id}`, {
			replace: true,
		});
	};

	useEffect(() => {
		getAgentLogs(experiment.id)
			.then((logs) => setTranscriptEntries(logs as unknown as TranscriptEntry[]))
			.catch(() => setTranscriptEntries([]));
	}, [experiment.id]);

	const sorted = [...runs].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
	const selectedRun = sorted.find((r) => r.id === activeRunId) ?? null;
	// Baseline = first completed run in the original runNumber order, NOT
	// the first attempt. Early failed runs shouldn't become the baseline.
	const baseline =
		[...runs].sort((a, b) => a.runNumber - b.runNumber).find((r) => r.status === "completed") ??
		null;

	const [paperError, setPaperError] = useState<string | null>(null);
	const [paperStarting, setPaperStarting] = useState(false);

	const handleGoPaper = async (runId: string) => {
		setPaperError(null);
		setPaperStarting(true);
		try {
			await goPaper(runId);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setPaperError(msg);
			console.error("go_paper failed:", err);
		} finally {
			setPaperStarting(false);
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
								isBaseline={baseline?.id === run.id}
								isSelected={run.id === activeRunId}
								onClick={() => selectRun(run.id)}
							/>
						))}
					</div>

					{/* Right: run detail */}
					{selectedRun && (
						<ScrollArea className="flex-1 min-w-0">
							<div className="p-4">
								<RunDetail
									run={selectedRun}
									baseline={baseline}
									onGoPaper={handleGoPaper}
									paperStarting={paperStarting}
									paperError={paperError}
									transcriptEntries={transcriptEntries}
								/>
							</div>
						</ScrollArea>
					)}
				</div>
			)}
		</div>
	);
}
