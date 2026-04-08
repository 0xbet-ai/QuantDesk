import { formatAgentMarkersForDisplay } from "@quantdesk/shared";
import {
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Code2,
	Database,
	MessageSquare,
	Send,
	Shield,
	User,
	XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLiveUpdates } from "../context/LiveUpdatesContext.js";
import type { Comment, DataFetchProposal, Dataset, Experiment } from "../lib/api.js";
import {
	completeAndCreateNewExperiment,
	getAgentLogs,
	listComments,
	listDatasets,
	postComment,
	postProposalDecision,
} from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { DatasetPreviewModal } from "./DatasetView.js";
import { TurnCard, type TurnLifecycleStatus } from "./TurnCard.js";
import type { TranscriptEntry } from "./transcript/RunTranscriptView.js";
import { RunTranscriptView } from "./transcript/RunTranscriptView.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Separator } from "./ui/separator.js";

interface Props {
	experiment: Experiment;
	onOpenRun?: () => void;
	onOpenTurn?: (turnId: string) => void;
	onNewExperiment?: (newExperiment: Experiment) => void;
	onExperimentUpdated?: () => void;
}

const authorConfig: Record<string, { icon: typeof User; color: string; label: string }> = {
	user: { icon: User, color: "text-blue-400", label: "You" },
	analyst: { icon: Bot, color: "text-green-400", label: "Analyst" },
	risk_manager: { icon: Shield, color: "text-orange-400", label: "Risk Manager" },
	system: { icon: Bot, color: "text-muted-foreground", label: "System" },
};

function CollapsibleCode({ lang, children }: { lang: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="my-2 rounded-md border border-border overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-1.5 w-full px-3 py-1.5 bg-muted/70 hover:bg-muted text-xs text-muted-foreground transition-colors"
			>
				<ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
				<Code2 className="size-3" />
				<span>{lang || "code"}</span>
			</button>
			{open && (
				<pre className="overflow-x-auto p-3 text-xs bg-zinc-950 text-zinc-200">
					<code>{children}</code>
				</pre>
			)}
		</div>
	);
}

const markdownComponents = {
	pre({ children }: { children?: ReactNode }) {
		return <>{children}</>;
	},
	code({
		className,
		children,
		...props
	}: { className?: string; children?: ReactNode; node?: unknown }) {
		const match = /language-(\w+)/.exec(className ?? "");
		if (match) {
			return <CollapsibleCode lang={match[1]!}>{children}</CollapsibleCode>;
		}
		return (
			<code className="bg-muted px-1 py-0.5 rounded text-[12px]" {...props}>
				{children}
			</code>
		);
	},
};

interface Proposal {
	type: "VALIDATION" | "NEW_EXPERIMENT" | "COMPLETE_EXPERIMENT" | "GO_PAPER";
	value: string;
}

const proposalLabels: Record<Proposal["type"], string> = {
	VALIDATION: "Run Risk Manager validation",
	NEW_EXPERIMENT: "Create new experiment",
	COMPLETE_EXPERIMENT: "Mark experiment as completed",
	GO_PAPER: "Start paper trading with this run",
};

// Server-side ProposalType (lowercase) → legacy ProposalCard type (uppercase).
// data_fetch is intentionally excluded — that gets its own card.
const METADATA_TO_PROPOSAL_TYPE: Record<string, Proposal["type"]> = {
	validation: "VALIDATION",
	new_experiment: "NEW_EXPERIMENT",
	complete_experiment: "COMPLETE_EXPERIMENT",
	go_paper: "GO_PAPER",
};

/**
 * Read a `Proposal` (the four legacy PROPOSE_* types) from the server-set
 * `pendingProposal` metadata. Returns null for data_fetch (handled by
 * `extractDataFetchProposal` below) and for any other shape.
 *
 * The server is the single owner of marker parsing — phase 04 wired the
 * `pendingProposal` shape onto every comment, and the UI must NEVER regex
 * the raw content for marker discovery.
 */
function extractLegacyProposal(metadata: Record<string, unknown> | null): Proposal | null {
	if (!metadata) return null;
	const pending = (metadata as { pendingProposal?: { type?: string; data?: { value?: string } } })
		.pendingProposal;
	if (!pending?.type) return null;
	const mapped = METADATA_TO_PROPOSAL_TYPE[pending.type];
	if (!mapped) return null;
	return { type: mapped, value: pending.data?.value ?? "" };
}

// Strip [user]/[analyst]/[system]/[risk_manager] prefixes the agent may echo.
// This is post-processing of agent output, not marker handling — kept here.
const AUTHOR_PREFIX_RE = /^\[(user|analyst|system|risk_manager)\]\s*/gm;
function stripAuthorPrefixes(text: string): string {
	return text.replace(AUTHOR_PREFIX_RE, "");
}

function ProposalCard({
	proposal,
	experimentId,
	onAction,
	onNewExperiment,
}: {
	proposal: Proposal;
	experimentId: string;
	onAction: () => void;
	onNewExperiment?: (newExp: Experiment) => void;
}) {
	const [status, setStatus] = useState<"pending" | "approved" | "declined">("pending");

	const handleApprove = async () => {
		setStatus("approved");

		// Special handling for NEW_EXPERIMENT — actually create the experiment
		if (proposal.type === "NEW_EXPERIMENT" && onNewExperiment) {
			try {
				const title = proposal.value || "New Experiment";
				const newExp = await completeAndCreateNewExperiment(experimentId, { title });
				onNewExperiment(newExp);
				return;
			} catch (err) {
				console.error("Failed to create new experiment:", err);
				setStatus("pending");
				return;
			}
		}

		const message = `Approved: ${proposalLabels[proposal.type]}${proposal.value ? ` — ${proposal.value}` : ""}`;
		await postComment(experimentId, message);
		onAction();
	};

	const handleDecline = async () => {
		setStatus("declined");
		const message = `Declined: ${proposalLabels[proposal.type]}`;
		await postComment(experimentId, message);
		onAction();
	};

	return (
		<div className="mt-2 rounded-md border border-border bg-muted/50 px-3 py-2">
			<span className="text-xs text-foreground">
				{proposalLabels[proposal.type]}
				{proposal.value && <span className="text-muted-foreground ml-1">— {proposal.value}</span>}
			</span>
			{status === "pending" ? (
				<div className="flex gap-2 mt-2">
					<Button
						size="sm"
						variant="outline"
						className="h-7 px-3 text-xs gap-1"
						onClick={handleApprove}
					>
						<CheckCircle2 className="size-3" />
						Approve
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-7 px-3 text-xs gap-1 text-muted-foreground"
						onClick={handleDecline}
					>
						<XCircle className="size-3" />
						Decline
					</Button>
				</div>
			) : (
				<div className="mt-1">
					<span
						className={cn(
							"text-xs font-medium",
							status === "approved" ? "text-green-500" : "text-muted-foreground",
						)}
					>
						{status === "approved" ? "Approved" : "Declined"}
					</span>
				</div>
			)}
		</div>
	);
}

function DataFetchProposalCard({
	proposal,
	commentId,
	experimentId,
	onAction,
}: {
	proposal: DataFetchProposal;
	commentId: string;
	experimentId: string;
	onAction: () => void;
}) {
	const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "replied">(
		"pending",
	);
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyText, setReplyText] = useState("");
	const [sending, setSending] = useState(false);

	const decide = async (action: "approve" | "reject") => {
		setStatus(action === "approve" ? "approved" : "rejected");
		try {
			await postProposalDecision(commentId, action);
			onAction();
		} catch (err) {
			console.error("data-fetch decision failed:", err);
			setStatus("pending");
		}
	};

	const sendReply = async () => {
		if (!replyText.trim() || sending) return;
		setSending(true);
		try {
			await postComment(experimentId, replyText.trim());
			setStatus("replied");
			setReplyOpen(false);
			setReplyText("");
			onAction();
		} catch (err) {
			console.error("data-fetch reply failed:", err);
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="mt-2 rounded-md border border-border bg-muted/50 px-3 py-2">
			<div className="text-xs font-medium text-foreground">Fetch historical data for backtest?</div>
			<div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
				<div>
					<span className="font-medium text-foreground">{proposal.pairs.join(", ")}</span> ·{" "}
					{proposal.timeframe} · last {proposal.days} days · {proposal.exchange}
					{proposal.tradingMode ? ` (${proposal.tradingMode})` : ""}
				</div>
				{proposal.rationale && <div className="italic">{proposal.rationale}</div>}
			</div>
			{status === "pending" ? (
				<>
					<div className="flex gap-2 mt-2">
						<Button
							size="sm"
							variant="outline"
							className="h-7 px-3 text-xs gap-1"
							onClick={() => decide("approve")}
						>
							<CheckCircle2 className="size-3" />
							Approve & download
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 px-3 text-xs gap-1 text-muted-foreground"
							onClick={() => decide("reject")}
						>
							<XCircle className="size-3" />
							Reject
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 px-3 text-xs gap-1 text-muted-foreground"
							onClick={() => setReplyOpen((v) => !v)}
						>
							<MessageSquare className="size-3" />
							Reply
						</Button>
					</div>
					{replyOpen && (
						<div className="mt-2 flex gap-2">
							<Input
								autoFocus
								value={replyText}
								onChange={(e) => setReplyText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										sendReply();
									}
								}}
								placeholder="Ask the agent to adjust the proposal..."
								disabled={sending}
								className="h-7 text-xs"
							/>
							<Button
								size="sm"
								className="h-7 px-3 text-xs"
								onClick={sendReply}
								disabled={sending || !replyText.trim()}
							>
								Send
							</Button>
						</div>
					)}
				</>
			) : (
				<div className="mt-1 text-xs font-medium">
					<span
						className={
							status === "approved"
								? "text-green-500"
								: status === "replied"
									? "text-blue-500"
									: "text-muted-foreground"
						}
					>
						{status === "approved"
							? "Approved — downloading..."
							: status === "replied"
								? "Reply sent"
								: "Rejected"}
					</span>
				</div>
			)}
		</div>
	);
}

function extractDataFetchProposal(
	metadata: Record<string, unknown> | null,
): DataFetchProposal | null {
	if (!metadata) return null;
	const pending = (metadata as { pendingProposal?: { type?: string; data?: unknown } })
		.pendingProposal;
	if (!pending || pending.type !== "data_fetch") return null;
	const data = pending.data as Partial<DataFetchProposal> | undefined;
	if (
		!data ||
		typeof data.exchange !== "string" ||
		!Array.isArray(data.pairs) ||
		typeof data.timeframe !== "string" ||
		typeof data.days !== "number"
	) {
		return null;
	}
	return data as DataFetchProposal;
}

function DatasetChips({ deskId, after }: { deskId: string; after: string }) {
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [selected, setSelected] = useState<Dataset | null>(null);

	useEffect(() => {
		listDatasets(deskId)
			.then(setDatasets)
			.catch(() => setDatasets([]));
	}, [deskId]);

	// Only show datasets created after this comment's timestamp
	const recent = datasets.filter(
		(d) => new Date(d.createdAt).getTime() <= new Date(after).getTime() + 60_000,
	);
	if (recent.length === 0) return null;

	return (
		<>
			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				<Database className="size-3 text-muted-foreground" />
				<span className="text-[11px] text-muted-foreground mr-1">Datasets:</span>
				{recent.map((d) => (
					<button
						key={d.id}
						type="button"
						onClick={() => setSelected(d)}
						className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-mono hover:border-cyan-500/30 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
					>
						<span>{d.exchange.toUpperCase()}</span>
						<span className="text-muted-foreground">·</span>
						<span>{d.pairs.join(",")}</span>
						<span className="text-muted-foreground">·</span>
						<span>{d.timeframe}</span>
					</button>
				))}
			</div>
			{selected && (
				<DatasetPreviewModal dataset={selected} deskId={deskId} onClose={() => setSelected(null)} />
			)}
		</>
	);
}

function AgentTranscriptToggle({ experimentId }: { experimentId: string }) {
	const [open, setOpen] = useState(false);
	const [entries, setEntries] = useState<TranscriptEntry[] | null>(null);

	const handleToggle = () => {
		if (!open && entries === null) {
			getAgentLogs(experimentId)
				.then((logs) => setEntries(logs as unknown as TranscriptEntry[]))
				.catch(() => setEntries([]));
		}
		setOpen((v) => !v);
	};

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={handleToggle}
				className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
			>
				{open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
				<span>View agent transcript</span>
			</button>
			{open && entries && entries.length > 0 && (
				<div className="mt-2 max-h-[400px] overflow-y-auto rounded-md border border-border/50 bg-muted/20 p-3">
					<RunTranscriptView entries={entries} density="compact" streaming={false} />
				</div>
			)}
			{open && entries && entries.length === 0 && (
				<div className="mt-2 text-[11px] text-muted-foreground">No transcript available.</div>
			)}
		</div>
	);
}

export function CommentThread({
	experiment,
	onOpenRun,
	onOpenTurn,
	onNewExperiment,
	onExperimentUpdated,
}: Props) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const [thinkingRole, setThinkingRole] = useState<string | null>(null);
	const [streamEntries, setStreamEntries] = useState<TranscriptEntry[]>([]);
	const [runStartedAt, setRunStartedAt] = useState<Date | null>(null);
	// Phase 27 — the TurnCard stays mounted after the agent finishes so the
	// user can always see the terminal state (completed / failed / stopped).
	// Only a new turn (next `agent.thinking` / `turn.status=running`) or an
	// explicit user send resets it.
	const [turnStatus, setTurnStatus] = useState<TurnLifecycleStatus | null>(null);
	const [turnFailureReason, setTurnFailureReason] = useState<string | null>(null);
	const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);
	// Phase 27 step 8 — live docker log tail from the engine container for
	// the run currently running inside the active turn. Capped at 200 lines.
	const [runLogLines, setRunLogLines] = useState<string[]>([]);
	// Live tail of `data_fetch.progress` events from the server. Cleared
	// whenever the comment thread refreshes (the next system comment —
	// "Downloaded …" or failure — supersedes the live tail).
	const [dataFetchProgress, setDataFetchProgress] = useState<string[]>([]);
	const bottomRef = useRef<HTMLDivElement>(null);

	const refresh = useCallback(() => {
		listComments(experiment.id)
			.then((data) => {
				setComments(data);
				// Show thinking if agent response is expected:
				// - only 1 comment (desk just created, agent trigger in progress)
				// - last comment is from user (waiting for agent reply)
				const last = data[data.length - 1];
				if (last && (data.length === 1 || last.author === "user")) {
					// Check persisted logs first — if the agent already produced a `result`
					// entry, the run is finished even though no comment was posted
					// (e.g. interrupted by server restart). In that case don't mark
					// the agent as thinking.
					getAgentLogs(experiment.id)
						.then((logs) => {
							const hasResult = logs.some((l) => (l as { type?: string }).type === "result");
							if (hasResult) {
								// Run already finished — don't show streaming widget
								setThinkingRole(null);
								setStreamEntries([]);
								setRunStartedAt(null);
							} else {
								setThinkingRole("analyst");
								if (logs.length > 0) {
									setStreamEntries(logs as unknown as TranscriptEntry[]);
									setRunStartedAt((prev) => prev ?? new Date(logs[0]!.ts));
								}
							}
						})
						.catch(() => {
							setThinkingRole("analyst");
						});
				}
				setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 50);
			})
			.catch(() => {});
	}, [experiment.id]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Auto-refresh on WebSocket events
	useLiveUpdates(experiment.id, (event) => {
		if (event.type === "agent.thinking") {
			const role = (event.payload as { agentRole?: string }).agentRole ?? "analyst";
			setThinkingRole(role);
			setStreamEntries([]);
			setRunStartedAt(new Date());
			setTurnStatus("running");
			setTurnFailureReason(null);
			setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
		}
		if (event.type === "run.log_chunk") {
			const payload = event.payload as { line?: string };
			if (payload.line) {
				setRunLogLines((prev) => {
					const next = [...prev, payload.line as string];
					return next.length > 200 ? next.slice(-200) : next;
				});
			}
		}
		if (event.type === "turn.status") {
			const payload = event.payload as {
				turnId?: string;
				status?: TurnLifecycleStatus;
				failureReason?: string | null;
			};
			if (payload.turnId) setCurrentTurnId(payload.turnId);
			if (payload.status) {
				setTurnStatus(payload.status);
				if (payload.status !== "running") {
					setTurnFailureReason(payload.failureReason ?? null);
				}
			}
		}
		if (event.type === "data_fetch.progress") {
			const payload = event.payload as { line?: string };
			if (payload.line) {
				setDataFetchProgress((prev) => {
					// Cap at 200 lines so a chatty downloader doesn't OOM the UI.
					const next = [...prev, payload.line as string];
					return next.length > 200 ? next.slice(-200) : next;
				});
			}
			setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
		}
		if (event.type === "agent.streaming") {
			const payload = event.payload as { chunk?: TranscriptEntry };
			const chunk = payload.chunk;
			if (chunk) {
				setStreamEntries((prev) => {
					// For text entries, replace the last text (Claude sends full text, not deltas)
					if (chunk.type === "text") {
						const last = prev[prev.length - 1];
						if (last?.type === "text") {
							return [...prev.slice(0, -1), chunk];
						}
					}
					return [...prev, chunk];
				});
			}
			setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
		}
		if (event.type === "agent.done") {
			// Phase 27 — do NOT clear the card on done. The turn.status event
			// (or this path when no explicit terminal came through) flips the
			// card into a terminal visual state, but it stays mounted so the
			// user can see "the agent finished" rather than watch the widget
			// vanish and wonder if it died.
			setThinkingRole(null);
			setRunStartedAt(null);
			setTurnStatus((prev) => (prev && prev !== "running" ? prev : "completed"));
			refresh();
		}
		if (event.type === "comment.new") {
			// A new comment supersedes any in-flight data-fetch progress —
			// the success / failure system comment that follows the download
			// is what the user should see now.
			setDataFetchProgress([]);
			refresh();
		}
		if (event.type === "experiment.updated") {
			onExperimentUpdated?.();
		}
	});

	const handleSend = async () => {
		if (!input.trim() || sending) return;
		setSending(true);
		try {
			await postComment(experiment.id, input.trim());
			setInput("");
			refresh();
			setThinkingRole("analyst");
			setStreamEntries([]);
			setRunStartedAt(new Date());
			setTurnStatus("running");
			setTurnFailureReason(null);
			setRunLogLines([]);
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="px-4 h-12 flex items-center gap-2 shrink-0">
				<span className="text-[13px] font-semibold">Experiment #{experiment.number}</span>
				<span className="text-[13px] text-muted-foreground">— {experiment.title}</span>
			</div>
			<Separator />

			{/* Messages */}
			<div className="flex-1 overflow-y-auto pl-4 pr-6 py-4 space-y-3">
				{(() => {
					const childrenByParent = new Map<string, Comment[]>();
					for (const c of comments) {
						const parentId = (c.metadata as { parentCommentId?: string } | null)?.parentCommentId;
						if (parentId) {
							const arr = childrenByParent.get(parentId) ?? [];
							arr.push(c);
							childrenByParent.set(parentId, arr);
						}
					}
					const topLevel = comments.filter(
						(c) => !(c.metadata as { parentCommentId?: string } | null)?.parentCommentId,
					);
					const renderComment = (c: Comment, isChild = false): ReactNode => {
						const config = authorConfig[c.author] ?? authorConfig.system!;
						const Icon = config.icon;
						const cleanContent = stripAuthorPrefixes(c.content).trim();
						const legacyProposal = extractLegacyProposal(c.metadata);
						const children = childrenByParent.get(c.id) ?? [];
						return (
							<div key={c.id} className={cn(isChild && "ml-6 mt-2")}>
								<div className="rounded-md border border-border p-3">
									<div className="flex items-center gap-2 mb-1.5">
										<div
											className={cn(
												"size-6 rounded-full flex items-center justify-center shrink-0",
												c.author === "user" ? "bg-blue-500/15" : "bg-muted",
											)}
										>
											<Icon className={cn("size-3", config.color)} />
										</div>
										<span className={cn("text-xs font-medium", config.color)}>{config.label}</span>
										<span className="text-xs text-muted-foreground ml-auto">
											{new Date(c.createdAt).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
									</div>
									{cleanContent && (
										<div className="text-[13px] text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-2 prose-li:my-0.5 prose-headings:mt-5 prose-headings:mb-2 prose-strong:text-foreground">
											<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
												{formatAgentMarkersForDisplay(cleanContent)}
											</Markdown>
										</div>
									)}
									{legacyProposal && (
										<ProposalCard
											proposal={legacyProposal}
											experimentId={experiment.id}
											onAction={() => {
												refresh();
												setThinkingRole("analyst");
												setStreamEntries([]);
											}}
											onNewExperiment={onNewExperiment}
										/>
									)}
									{(() => {
										const dfp = extractDataFetchProposal(c.metadata);
										return dfp ? (
											<DataFetchProposalCard
												proposal={dfp}
												commentId={c.id}
												experimentId={experiment.id}
												onAction={() => {
													// Don't preemptively show the AGENT TURN widget here.
													// The download runs first; the real `agent.thinking`
													// WebSocket event will arrive after it finishes and the
													// server retriggers the agent. Showing the empty widget
													// during the download stacks an "Agent is working" panel
													// under the live data-fetch tail, which is misleading.
													refresh();
												}}
											/>
										) : null;
									})()}
									{(c.author === "analyst" || c.author === "risk_manager") && (
										<>
											<DatasetChips deskId={experiment.deskId} after={c.createdAt} />
											<AgentTranscriptToggle experimentId={experiment.id} />
										</>
									)}
								</div>
								{children.map((child) => renderComment(child, true))}
							</div>
						);
					};
					return topLevel.map((c) => renderComment(c));
				})()}
				{comments.length === 0 && !thinkingRole && (
					<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
						No comments yet
					</div>
				)}
				{dataFetchProgress.length > 0 && (
					<div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
						<div className="flex items-center gap-2 mb-1.5">
							<div className="size-1.5 rounded-full bg-cyan-500 animate-pulse" />
							<span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
								Data fetch · live
							</span>
						</div>
						<pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap leading-tight max-h-48 overflow-y-auto">
							{dataFetchProgress.slice(-30).join("\n")}
						</pre>
					</div>
				)}
				{turnStatus && (
					<div className="sticky bottom-0 z-10 -mx-4 px-4 pt-2 pb-2 bg-gradient-to-t from-background via-background to-background/80 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
						<TurnCard
							experimentNumber={experiment.number}
							agentRole={thinkingRole ?? "analyst"}
							entries={streamEntries}
							status={turnStatus}
							startedAt={runStartedAt ?? undefined}
							failureReason={turnFailureReason}
							runLogLines={runLogLines}
							onStop={async () => {
								await fetch(`/api/experiments/${experiment.id}/agent/stop`, {
									method: "POST",
								});
								setThinkingRole(null);
								setTurnStatus("stopped");
							}}
							onOpen={
								currentTurnId && onOpenTurn ? () => onOpenTurn(currentTurnId) : onOpenRun
							}
							hasRun={!!currentTurnId}
						/>
					</div>
				)}
				<div ref={bottomRef} />
			</div>

			{/* Input */}
			<Separator />
			<div className="px-4 py-3">
				<div className="flex gap-2">
					<Input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && !thinkingRole && handleSend()}
						placeholder={thinkingRole ? "Agent is working..." : "Type a comment..."}
						disabled={!!thinkingRole}
					/>
					<Button
						size="sm"
						onClick={handleSend}
						disabled={sending || !input.trim() || !!thinkingRole}
					>
						<Send className="size-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}
