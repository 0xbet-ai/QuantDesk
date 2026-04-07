import { Bot, ExternalLink, Shield, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils.js";
import { StatusBadge } from "./StatusBadge.js";
import type { TranscriptEntry } from "./transcript/RunTranscriptView.js";
import { RunTranscriptView } from "./transcript/RunTranscriptView.js";

interface LiveRunWidgetProps {
	experimentNumber: number;
	agentRole: string;
	entries: TranscriptEntry[];
	streaming: boolean;
	startedAt?: Date;
	onStop: () => void;
	onOpenRun?: () => void;
}

function ElapsedTimer({ startedAt }: { startedAt: Date }) {
	const [elapsed, setElapsed] = useState(() =>
		Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)),
	);

	useEffect(() => {
		const id = setInterval(() => {
			setElapsed(Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)));
		}, 1000);
		return () => clearInterval(id);
	}, [startedAt]);

	const mins = Math.floor(elapsed / 60);
	const secs = elapsed % 60;
	return (
		<span className="text-xs text-muted-foreground tabular-nums font-mono">
			{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
		</span>
	);
}

export function LiveRunWidget({
	experimentNumber,
	agentRole,
	entries,
	streaming,
	startedAt,
	onStop,
	onOpenRun,
}: LiveRunWidgetProps) {
	const isAnalyst = agentRole !== "risk_manager";
	const roleLabel = isAnalyst ? "Analyst" : "Risk Manager";
	const RoleIcon = isAnalyst ? Bot : Shield;
	const avatarBg = isAnalyst
		? "bg-purple-100 dark:bg-purple-900/40"
		: "bg-orange-100 dark:bg-orange-900/40";
	const avatarIconColor = isAnalyst
		? "text-purple-700 dark:text-purple-300"
		: "text-orange-700 dark:text-orange-300";
	const roleTextColor = isAnalyst
		? "text-purple-700 dark:text-purple-300"
		: "text-orange-700 dark:text-orange-300";

	return (
		<div className="overflow-hidden rounded-xl border border-cyan-500/25 bg-background/80 shadow-[0_18px_50px_rgba(6,182,212,0.08)]">
			{/* Header */}
			<div className="border-b border-border/60 bg-cyan-500/[0.04] px-4 py-3">
				<div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
					{streaming ? "Live Run" : "Run Completed"}
				</div>
				<div className="mt-1 text-xs text-muted-foreground">
					{streaming
						? `Agent is working on Experiment #${experimentNumber}`
						: `Agent finished on Experiment #${experimentNumber}`}
				</div>
			</div>

			{/* Agent identity + controls */}
			<section className="px-4 py-4">
				<div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0">
						{/* Agent identity */}
						<div className="flex items-center gap-2">
							<div
								className={cn(
									"flex size-5 items-center justify-center rounded-full shrink-0 ring-2 ring-background",
									avatarBg,
								)}
							>
								<RoleIcon className={cn("size-2.5", avatarIconColor)} />
							</div>
							<span className={cn("text-xs font-medium", roleTextColor)}>{roleLabel}</span>
						</div>

						{/* Status row */}
						<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<StatusBadge status={streaming ? "running" : "completed"} />
							{streaming && startedAt && <ElapsedTimer startedAt={startedAt} />}
							{streaming && (
								<span className="flex items-center gap-1 text-xs text-cyan-400">
									<span className="relative flex h-2 w-2">
										<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
										<span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
									</span>
									Live
								</span>
							)}
						</div>
					</div>

					{/* Controls */}
					<div className="flex items-center gap-2">
						{streaming && (
							<button
								type="button"
								onClick={onStop}
								className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-500/[0.12] dark:text-red-300"
							>
								<Square className="h-2.5 w-2.5" fill="currentColor" />
								Stop
							</button>
						)}
						{onOpenRun && (
							<button
								type="button"
								onClick={onOpenRun}
								className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-cyan-700 transition-colors hover:border-cyan-500/30 hover:text-cyan-600 dark:text-cyan-300"
							>
								Open run
								<ExternalLink className="h-3 w-3" />
							</button>
						)}
					</div>
				</div>

				{/* Transcript */}
				<div className="max-h-[320px] overflow-y-auto pr-1">
					<RunTranscriptView
						entries={entries}
						density="compact"
						limit={8}
						streaming={streaming}
						emptyMessage="Waiting for agent output..."
					/>
				</div>
			</section>
		</div>
	);
}
