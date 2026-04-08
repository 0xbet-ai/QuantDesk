import { Bot, Database, ExternalLink, Shield, Square, Terminal } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/utils.js";
import { StatusBadge } from "./StatusBadge.js";
import type { TranscriptEntry } from "./transcript/RunTranscriptView.js";
import { RunTranscriptView } from "./transcript/RunTranscriptView.js";

export type TurnLifecycleStatus =
	| "running"
	| "completed"
	| "failed"
	| "stopped"
	| "awaiting_user";

interface TurnCardProps {
	experimentNumber: number;
	agentRole: string;
	entries: TranscriptEntry[];
	/** Lifecycle status of the turn. `running` → live, anything else → terminal. */
	status: TurnLifecycleStatus;
	startedAt?: Date;
	onStop: () => void;
	onOpen?: () => void;
	/** When set and non-null the "Open" button is rendered and routes to this turn's run detail. */
	hasRun?: boolean;
	/** Populated when `status` is `failed` or `stopped` — shown in the header as a red reason line. */
	failureReason?: string | null;
	/** Phase 27 step 8 — live docker log tail from the engine container, if a backtest is running inside this turn. */
	runLogLines?: string[];
	/** Live data-fetch progress lines from the server, if a download is in flight inside this turn. */
	dataFetchProgress?: string[];
	mode?: "backtest" | "paper" | "turn";
	/**
	 * Pre-rendered system / analyst / risk_manager comments that belong to
	 * this turn. The CommentThread no longer renders these at top level —
	 * everything that happened inside a turn lives inside the turn card so
	 * the user only sees two top-level entry types: their own comments and
	 * agent turn cards.
	 */
	nestedComments?: ReactNode;
	/**
	 * Meta actions rendered below the timeline but still inside the card
	 * body — e.g. "View agent transcript" toggle. Not part of the timeline
	 * flow so it doesn't get a timeline icon.
	 */
	footer?: ReactNode;
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

export function TurnCard({
	experimentNumber,
	agentRole,
	entries,
	status,
	startedAt,
	onStop,
	onOpen,
	hasRun,
	failureReason,
	runLogLines,
	dataFetchProgress,
	mode = "turn",
	nestedComments,
	footer,
}: TurnCardProps) {
	const streaming = status === "running";
	const isTerminal = !streaming;
	const isFailed = status === "failed" || status === "stopped";
	const isAwaitingUser = status === "awaiting_user";
	const modeLabel =
		mode === "paper" ? "Paper Trading Run" : mode === "backtest" ? "Backtest Run" : "Agent Turn";
	const terminalLabel =
		status === "completed"
			? `${modeLabel} Completed`
			: status === "stopped"
				? `${modeLabel} Stopped`
				: status === "awaiting_user"
					? `${modeLabel} · Awaiting Your Response`
					: `${modeLabel} Failed`;
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
		<div
			className={cn(
				"overflow-hidden rounded-xl border bg-background/80 shadow-[0_18px_50px_rgba(6,182,212,0.08)]",
				isFailed ? "border-red-500/30" : "border-cyan-500/25",
			)}
		>
			{/* Agent identity — sits above the card header so the user sees
			    "who is acting" before reading what state the turn is in. */}
			<div className="flex items-center gap-2 px-4 pt-3">
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

			{/* Header */}
			<div
				className={cn(
					"border-b border-border/60 px-4 py-3",
					isFailed ? "bg-red-500/[0.05]" : "bg-cyan-500/[0.04]",
				)}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div
							className={cn(
								"text-xs font-semibold uppercase tracking-[0.18em]",
								isFailed
									? "text-red-700 dark:text-red-300"
									: "text-cyan-700 dark:text-cyan-300",
							)}
						>
							{streaming ? modeLabel : terminalLabel}
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							{streaming
								? `Agent is working on Experiment #${experimentNumber}`
								: status === "completed"
									? `Agent finished Experiment #${experimentNumber}`
									: status === "awaiting_user"
										? `Agent is waiting on you — Experiment #${experimentNumber}`
										: `Agent did not finish cleanly — Experiment #${experimentNumber}`}
						</div>
						{isTerminal && isFailed && failureReason && (
							<div className="mt-1 text-[11px] font-mono text-red-600 dark:text-red-400">
								{failureReason}
							</div>
						)}
					</div>
					{/* Status badge + controls — moved into the header so the
					    body section can be a flat list of nested comments. */}
					<div className="flex items-center gap-2 shrink-0">
						<StatusBadge
							status={
								streaming
									? "running"
									: isFailed
										? "failed"
										: isAwaitingUser
											? "awaiting_user"
											: "completed"
							}
						/>
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
						{onOpen && hasRun && (
							<button
								type="button"
								onClick={onOpen}
								className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-cyan-700 transition-colors hover:border-cyan-500/30 hover:text-cyan-600 dark:text-cyan-300"
							>
								Open
								<ExternalLink className="h-3 w-3" />
							</button>
						)}
					</div>
				</div>
			</div>

			{/* Body */}
			<section className="px-4 py-3">

				{/* Timeline of nested events — system/analyst/risk_manager
				    messages, proposal cards, and live engine / data-fetch
				    logs that belong to this turn. Each row is rendered with
				    an icon overlapping a vertical line on the left so the
				    turn looks like a thread of steps. */}
				{(nestedComments ||
					(dataFetchProgress && dataFetchProgress.length > 0) ||
					(runLogLines && runLogLines.length > 0)) && (
					<div className="relative">
						{/* Timeline line — absolute positioned so icons can
						    sit on top of it without border-l fighting the
						    icon's background. */}
						<div
							aria-hidden
							className="pointer-events-none absolute left-[11px] top-2 bottom-2 w-px bg-neutral-300 dark:bg-neutral-700"
						/>
						{nestedComments && <div className="text-[13px]">{nestedComments}</div>}
						{dataFetchProgress && dataFetchProgress.length > 0 && (
							<div className="relative pl-8 pb-3">
								<div className="absolute left-0 top-0 z-10 flex size-6 items-center justify-center rounded-full bg-cyan-100 ring-4 ring-background dark:bg-cyan-900/40">
									<Database className="size-3 text-cyan-700 dark:text-cyan-300 animate-pulse" />
								</div>
								<div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
									Data fetch · live
								</div>
								<pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-tight text-muted-foreground">
									{dataFetchProgress.slice(-30).join("\n")}
								</pre>
							</div>
						)}
						{runLogLines && runLogLines.length > 0 && (
							<div className="relative pl-8 pb-3">
								<div className="absolute left-0 top-0 z-10 flex size-6 items-center justify-center rounded-full bg-cyan-100 ring-4 ring-background dark:bg-cyan-900/40">
									<Terminal
										className={cn(
											"size-3 text-cyan-700 dark:text-cyan-300",
											streaming && "animate-pulse",
										)}
									/>
								</div>
								<div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
									Engine container {streaming ? "· live" : ""}
								</div>
								<pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-tight text-muted-foreground">
									{runLogLines.slice(-30).join("\n")}
								</pre>
							</div>
						)}
					</div>
				)}

				{/* Transcript — only useful while streaming or when there's no
				    persisted comment yet. Once the turn has nested comments
				    the transcript is redundant and we hide it to keep the card
				    focused. */}
				{(!nestedComments || streaming) && (
					<div className="max-h-[320px] overflow-y-auto pr-4 mt-3">
						<RunTranscriptView
							entries={entries}
							density="compact"
							limit={8}
							streaming={streaming}
							emptyMessage="Waiting for agent output..."
						/>
					</div>
				)}

				{/* Meta actions (e.g. transcript toggle) — outside the timeline
				    container so they don't get a timeline icon. */}
				{footer && <div className="mt-3">{footer}</div>}
			</section>
		</div>
	);
}
