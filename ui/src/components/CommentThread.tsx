import {
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Code2,
	Database,
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
import type { Comment, Dataset, DataFetchProposal, Experiment } from "../lib/api.js";
import {
	completeAndCreateNewExperiment,
	getAgentLogs,
	listComments,
	listDatasets,
	postComment,
	postDataFetchDecision,
} from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { DatasetPreviewModal } from "./DatasetView.js";
import { RunWidget } from "./RunWidget.js";
import type { TranscriptEntry } from "./transcript/RunTranscriptView.js";
import { RunTranscriptView } from "./transcript/RunTranscriptView.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Separator } from "./ui/separator.js";

interface Props {
	experiment: Experiment;
	onOpenRun?: () => void;
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

const PROPOSAL_RE =
	/^\[PROPOSE_(VALIDATION|NEW_EXPERIMENT|COMPLETE_EXPERIMENT|GO_PAPER)\]\s*(?:—\s*)?(.*)$/gm;

// Strip [user]/[analyst]/[system]/[risk_manager] prefixes that the agent may echo
const AUTHOR_PREFIX_RE = /^\[(user|analyst|system|risk_manager)\]\s*/gm;

/** Convert [BACKTEST_RESULT] and [DATASET] markers to fenced JSON code blocks,
 *  and strip internal markers like [EXPERIMENT_TITLE]. */
function formatAgentMarkers(text: string): string {
	return text
		.replace(
			/\[BACKTEST_RESULT\]\s*([\s\S]*?)\s*\[\/BACKTEST_RESULT\]/g,
			(_match, json: string) => `\n\`\`\`json\n${json.trim()}\n\`\`\`\n`,
		)
		.replace(
			/\[DATASET\]\s*([\s\S]*?)\s*\[\/DATASET\]/g,
			(_match, json: string) => `\n\`\`\`json\n${json.trim()}\n\`\`\`\n`,
		)
		.replace(/^\[EXPERIMENT_TITLE\].*$/gm, "")
		.replace(/\n{3,}/g, "\n\n");
}

function parseProposals(content: string): { cleanContent: string; proposals: Proposal[] } {
	const proposals: Proposal[] = [];
	let cleanContent = content.replace(PROPOSAL_RE, (_, type: Proposal["type"], value: string) => {
		// Strip nested [PROPOSE_*] markers from value
		const cleanValue = value
			.trim()
			.replace(/\[PROPOSE_\w+\]/g, "")
			.replace(/—\s*$/, "")
			.trim();
		proposals.push({ type, value: cleanValue });
		return "";
	});
	// Catch any remaining standalone markers not on their own line
	cleanContent = cleanContent.replace(
		/\[PROPOSE_(VALIDATION|NEW_EXPERIMENT|COMPLETE_EXPERIMENT|GO_PAPER)\]/g,
		(_, type: Proposal["type"]) => {
			if (!proposals.some((p) => p.type === type)) {
				proposals.push({ type, value: "" });
			}
			return "";
		},
	);
	cleanContent = cleanContent.replace(AUTHOR_PREFIX_RE, "");
	return { cleanContent: cleanContent.trim(), proposals };
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
	experimentId,
	onAction,
}: {
	proposal: DataFetchProposal;
	experimentId: string;
	onAction: () => void;
}) {
	const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");

	const decide = async (action: "approve" | "reject") => {
		setStatus(action === "approve" ? "approved" : "rejected");
		try {
			await postDataFetchDecision(experimentId, action, proposal);
			onAction();
		} catch (err) {
			console.error("data-fetch decision failed:", err);
			setStatus("pending");
		}
	};

	return (
		<div className="mt-2 rounded-md border border-border bg-muted/50 px-3 py-2">
			<div className="text-xs font-medium text-foreground">
				Fetch historical data for backtest?
			</div>
			<div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
				<div>
					<span className="font-medium text-foreground">{proposal.pairs.join(", ")}</span> ·{" "}
					{proposal.timeframe} · last {proposal.days} days · {proposal.exchange}
					{proposal.tradingMode ? ` (${proposal.tradingMode})` : ""}
				</div>
				{proposal.rationale && <div className="italic">{proposal.rationale}</div>}
			</div>
			{status === "pending" ? (
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
				</div>
			) : (
				<div className="mt-1 text-xs font-medium">
					<span className={status === "approved" ? "text-green-500" : "text-muted-foreground"}>
						{status === "approved" ? "Approved — downloading..." : "Rejected"}
					</span>
				</div>
			)}
		</div>
	);
}

function extractDataFetchProposal(metadata: Record<string, unknown> | null): DataFetchProposal | null {
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
	onNewExperiment,
	onExperimentUpdated,
}: Props) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const [thinkingRole, setThinkingRole] = useState<string | null>(null);
	const [streamEntries, setStreamEntries] = useState<TranscriptEntry[]>([]);
	const [runStartedAt, setRunStartedAt] = useState<Date | null>(null);
	const [fadingOut, setFadingOut] = useState(false);
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
			setThinkingRole(null);
			setRunStartedAt(null);
			refresh();
			// Fade out the live widget — the completed transcript is now in the comment card
			setFadingOut(true);
			setTimeout(() => {
				setStreamEntries([]);
				setFadingOut(false);
			}, 600);
		}
		if (event.type === "comment.new") {
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
				{comments.map((c) => {
					const config = authorConfig[c.author] ?? authorConfig.system!;
					const Icon = config.icon;
					const { cleanContent, proposals } = parseProposals(c.content);
					return (
						<div key={c.id} className="rounded-md border border-border p-3">
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
										{formatAgentMarkers(cleanContent)}
									</Markdown>
								</div>
							)}
							{proposals.map((p) => (
								<ProposalCard
									key={p.type}
									proposal={p}
									experimentId={experiment.id}
									onAction={() => {
										refresh();
										setThinkingRole("analyst");
										setStreamEntries([]);
									}}
									onNewExperiment={onNewExperiment}
								/>
							))}
							{(() => {
								const dfp = extractDataFetchProposal(c.metadata);
								return dfp ? (
									<DataFetchProposalCard
										proposal={dfp}
										experimentId={experiment.id}
										onAction={() => {
											refresh();
											setThinkingRole("analyst");
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
					);
				})}
				{comments.length === 0 && !thinkingRole && (
					<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
						No comments yet
					</div>
				)}
				{(thinkingRole || streamEntries.length > 0) && (
					<div
						className={cn(
							"transition-all duration-500 ease-out",
							fadingOut
								? "opacity-0 -translate-y-2 max-h-0 overflow-hidden"
								: "opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-2 duration-300",
						)}
					>
						<RunWidget
							experimentNumber={experiment.number}
							agentRole={thinkingRole ?? "analyst"}
							entries={streamEntries}
							streaming={!!thinkingRole}
							startedAt={runStartedAt ?? undefined}
							onStop={async () => {
								await fetch(`/api/experiments/${experiment.id}/agent/stop`, {
									method: "POST",
								});
								setThinkingRole(null);
								setStreamEntries([]);
								setRunStartedAt(null);
							}}
							onOpenRun={onOpenRun}
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
