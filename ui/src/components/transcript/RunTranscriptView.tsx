import {
	Check,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	Code2,
	TerminalSquare,
	Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils.js";

// ── Types ────────────────────────────────────────────────────────────

export interface TranscriptEntry {
	type: "tool" | "text" | "tool_result" | "system" | "event";
	content: string;
	tool?: string;
	label?: string;
	detail?: string;
	expandable?: string;
	tone?: "info" | "warn" | "error" | "neutral";
}

interface ToolItem {
	content: string;
	tool?: string;
	label?: string;
	detail?: string;
	expandable?: string;
	status: "running" | "completed" | "error";
}

type TranscriptBlock =
	| { type: "text"; content: string; streaming: boolean }
	| ({ type: "tool" } & ToolItem)
	| { type: "command_group"; items: ToolItem[] }
	| { type: "tool_group"; items: ToolItem[] }
	| { type: "system"; content: string }
	| { type: "event"; label: string; content: string; tone: "info" | "warn" | "error" | "neutral" };

// ── Helpers ──────────────────────────────────────────────────────────

function isCommandTool(item: ToolItem): boolean {
	if (item.tool === "Bash") return true;
	if (item.label === "Running") return true;
	return false;
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

// ── Normalization ────────────────────────────────────────────────────

function normalizeTranscript(entries: TranscriptEntry[], streaming: boolean): TranscriptBlock[] {
	const blocks: TranscriptBlock[] = [];

	for (const entry of entries) {
		if (entry.type === "text") {
			const last = blocks[blocks.length - 1];
			if (last?.type === "text") {
				last.content = entry.content;
				last.streaming = streaming;
			} else {
				blocks.push({ type: "text", content: entry.content, streaming });
			}
			continue;
		}

		if (entry.type === "tool") {
			blocks.push({
				type: "tool",
				content: entry.content,
				tool: entry.tool,
				label: entry.label,
				detail: entry.detail,
				expandable: entry.expandable,
				status: "running",
			});
			continue;
		}

		if (entry.type === "tool_result") {
			for (let i = blocks.length - 1; i >= 0; i--) {
				const block = blocks[i]!;
				if (block.type === "tool" && block.status === "running") {
					block.expandable = entry.content;
					block.status = "completed";
					break;
				}
			}
			continue;
		}

		if (entry.type === "system") {
			blocks.push({ type: "system", content: entry.content });
			continue;
		}

		if (entry.type === "event") {
			blocks.push({
				type: "event",
				label: entry.label ?? "event",
				content: entry.content,
				tone: entry.tone ?? "info",
			});
		}
	}

	return groupToolBlocks(groupCommandBlocks(blocks));
}

/** Group consecutive command (Bash) tool blocks into command_group */
function groupCommandBlocks(blocks: TranscriptBlock[]): TranscriptBlock[] {
	const grouped: TranscriptBlock[] = [];
	let pending: ToolItem[] = [];

	const flush = () => {
		if (pending.length === 0) return;
		if (pending.length === 1) {
			grouped.push({ type: "tool", ...pending[0]! });
		} else {
			grouped.push({ type: "command_group", items: pending });
		}
		pending = [];
	};

	for (const block of blocks) {
		if (block.type === "tool" && isCommandTool(block)) {
			pending.push({
				content: block.content,
				tool: block.tool,
				label: block.label,
				detail: block.detail,
				expandable: block.expandable,
				status: block.status,
			});
		} else {
			flush();
			grouped.push(block);
		}
	}
	flush();
	return grouped;
}

/** Group consecutive non-command tool blocks into tool_group */
function groupToolBlocks(blocks: TranscriptBlock[]): TranscriptBlock[] {
	const grouped: TranscriptBlock[] = [];
	let pending: ToolItem[] = [];

	const flush = () => {
		if (pending.length === 0) return;
		if (pending.length === 1) {
			grouped.push({ type: "tool", ...pending[0]! });
		} else {
			grouped.push({ type: "tool_group", items: pending });
		}
		pending = [];
	};

	for (const block of blocks) {
		if (block.type === "tool" && !isCommandTool(block)) {
			pending.push({
				content: block.content,
				tool: block.tool,
				label: block.label,
				detail: block.detail,
				expandable: block.expandable,
				status: block.status,
			});
		} else {
			flush();
			grouped.push(block);
		}
	}
	flush();
	return grouped;
}

// ── Markdown components ──────────────────────────────────────────────

function CollapsibleCode({ lang, children }: { lang: string; children: React.ReactNode }) {
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
	pre({ children }: { children?: React.ReactNode }) {
		return <>{children}</>;
	},
	code({
		className,
		children,
		...props
	}: { className?: string; children?: React.ReactNode; node?: unknown }) {
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

// ── Block renderers ──────────────────────────────────────────────────

function TranscriptTextBlock({
	block,
	compact,
}: {
	block: Extract<TranscriptBlock, { type: "text" }>;
	compact: boolean;
}) {
	return (
		<div>
			<div
				className={cn(
					"text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2 prose-strong:text-foreground",
					compact ? "text-xs" : "text-[13px]",
				)}
			>
				<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
					{block.content}
				</Markdown>
			</div>
			{block.streaming && (
				<div className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium italic text-muted-foreground">
					<span className="relative flex h-1.5 w-1.5">
						<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70" />
						<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
					</span>
					Streaming
				</div>
			)}
		</div>
	);
}

function TranscriptToolCard({
	item,
	compact,
}: {
	item: ToolItem;
	compact: boolean;
}) {
	const [open, setOpen] = useState(item.status === "error");
	const isCommand = isCommandTool(item);

	const statusLabel =
		item.status === "running" ? "Running" : item.status === "error" ? "Errored" : "Completed";
	const statusTone =
		item.status === "running"
			? "text-cyan-700 dark:text-cyan-300"
			: item.status === "error"
				? "text-red-700 dark:text-red-300"
				: "text-emerald-700 dark:text-emerald-300";
	const iconClass = cn(
		"mt-0.5 h-3.5 w-3.5 shrink-0",
		item.status === "error"
			? "text-red-600 dark:text-red-300"
			: item.status === "completed"
				? "text-emerald-600 dark:text-emerald-300"
				: "text-cyan-600 dark:text-cyan-300",
	);

	const Icon = isCommand
		? TerminalSquare
		: item.status === "error"
			? CircleAlert
			: item.status === "completed"
				? Check
				: Wrench;

	return (
		<div
			className={cn(
				item.status === "error" && "rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3",
			)}
		>
			<div className="flex items-start gap-2">
				<Icon className={cn(iconClass, item.status === "running" && "animate-pulse")} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							{isCommand ? "Executing command" : (item.label ?? "tool")}
						</span>
						<span
							className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", statusTone)}
						>
							{statusLabel}
						</span>
					</div>
					<div
						className={cn(
							"mt-1 break-words font-mono text-foreground/80",
							compact ? "text-xs" : "text-sm",
						)}
					>
						{item.detail ?? item.content}
					</div>
				</div>
				{(item.expandable || item.status === "running") && (
					<button
						type="button"
						className="mt-0.5 inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => setOpen((v) => !v)}
						aria-label={open ? "Collapse" : "Expand"}
					>
						{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
					</button>
				)}
			</div>
			{open && item.expandable && (
				<div className="mt-3">
					<pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-200 bg-zinc-950 rounded-md p-3 max-h-40">
						{item.expandable}
					</pre>
				</div>
			)}
		</div>
	);
}

/** Paperclip-style command group: stacked TerminalSquare icons + "EXECUTED N COMMANDS" */
function TranscriptCommandGroup({
	block,
	compact,
}: {
	block: Extract<TranscriptBlock, { type: "command_group" }>;
	compact: boolean;
}) {
	const [open, setOpen] = useState(false);
	const isRunning = block.items.some((item) => item.status === "running");
	const hasError = block.items.some((item) => item.status === "error");
	const runningItem = [...block.items].reverse().find((item) => item.status === "running");
	const title = isRunning
		? "Executing command"
		: block.items.length === 1
			? "Executed command"
			: `Executed ${block.items.length} commands`;
	const subtitle = runningItem ? (runningItem.detail ?? runningItem.content) : null;

	return (
		<div
			className={cn(
				open && hasError && "rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3",
			)}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: nested interactive button inside */}
			<div
				role="button"
				tabIndex={0}
				className={cn("flex cursor-pointer gap-2", subtitle ? "items-start" : "items-center")}
				onClick={() => setOpen((v) => !v)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setOpen((v) => !v);
					}
				}}
			>
				<div className={cn("flex shrink-0 items-center", subtitle && "mt-0.5")}>
					{block.items.slice(0, Math.min(block.items.length, 3)).map((item, index) => (
						<span
							key={`cmd-${item.content.slice(0, 15)}-${index}`}
							className={cn(
								"inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm",
								index > 0 && "-ml-1.5",
								isRunning
									? "border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-600 dark:text-cyan-300 animate-pulse"
									: "border-border/70 bg-background text-foreground/55",
							)}
						>
							<TerminalSquare className="h-3.5 w-3.5" />
						</span>
					))}
				</div>
				<div className="min-w-0 flex-1">
					<div className="text-[11px] font-semibold uppercase leading-none tracking-[0.1em] text-muted-foreground/70">
						{title}
					</div>
					{subtitle && (
						<div
							className={cn(
								"mt-1 break-words font-mono text-foreground/85",
								compact ? "text-xs" : "text-sm",
							)}
						>
							{truncate(subtitle, compact ? 72 : 120)}
						</div>
					)}
				</div>
				<button
					type="button"
					className={cn(
						"inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
						subtitle && "mt-0.5",
					)}
					onClick={(e) => {
						e.stopPropagation();
						setOpen((v) => !v);
					}}
					aria-label={open ? "Collapse" : "Expand"}
				>
					{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
				</button>
			</div>
			{open && (
				<div
					className={cn(
						"mt-3 space-y-3",
						hasError && "rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3",
					)}
				>
					{block.items.map((item, index) => (
						<div key={`ci-${item.content.slice(0, 15)}-${index}`} className="space-y-2">
							<div className="flex items-center gap-2">
								<span
									className={cn(
										"inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
										item.status === "error"
											? "border-red-500/25 bg-red-500/[0.08] text-red-600 dark:text-red-300"
											: item.status === "running"
												? "border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-600 dark:text-cyan-300"
												: "border-border/70 bg-background text-foreground/55",
									)}
								>
									<TerminalSquare className="h-3 w-3" />
								</span>
								<span className={cn("font-mono break-all", compact ? "text-[11px]" : "text-xs")}>
									{truncate(item.detail ?? item.content, compact ? 72 : 120)}
								</span>
							</div>
							{item.expandable && (
								<pre
									className={cn(
										"ml-7 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]",
										item.status === "error"
											? "text-red-700 dark:text-red-300"
											: "text-zinc-200 bg-zinc-950 rounded-md p-2 max-h-40",
									)}
								>
									{item.expandable}
								</pre>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** Paperclip-style tool group: stacked Wrench icons + "USED N TOOLS" */
function TranscriptToolGroup({
	block,
	compact,
}: {
	block: Extract<TranscriptBlock, { type: "tool_group" }>;
	compact: boolean;
}) {
	const [open, setOpen] = useState(false);
	const isRunning = block.items.some((item) => item.status === "running");
	const hasError = block.items.some((item) => item.status === "error");
	const uniqueLabels = [...new Set(block.items.map((item) => item.label).filter(Boolean))];
	const toolLabel = uniqueLabels.length === 1 ? uniqueLabels[0]! : `${uniqueLabels.length} tools`;
	const runningItem = [...block.items].reverse().find((item) => item.status === "running");
	const title = isRunning
		? `Using ${toolLabel}`
		: block.items.length === 1
			? `Used ${toolLabel}`
			: `Used ${toolLabel} (${block.items.length} calls)`;
	const subtitle = runningItem ? (runningItem.detail ?? runningItem.content) : null;

	return (
		<div className="rounded-xl border border-border/40 bg-muted/[0.25]">
			{/* biome-ignore lint/a11y/useSemanticElements: nested interactive button inside */}
			<div
				role="button"
				tabIndex={0}
				className={cn(
					"flex cursor-pointer gap-2 px-3 py-2.5",
					subtitle ? "items-start" : "items-center",
				)}
				onClick={() => setOpen((v) => !v)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setOpen((v) => !v);
					}
				}}
			>
				<div className={cn("flex shrink-0 items-center", subtitle && "mt-0.5")}>
					{block.items.slice(0, Math.min(block.items.length, 3)).map((item, index) => {
						const isItemRunning = item.status === "running";
						const isItemError = item.status === "error";
						return (
							<span
								key={`tg-${item.content.slice(0, 15)}-${index}`}
								className={cn(
									"inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm",
									index > 0 && "-ml-1.5",
									isItemRunning
										? "border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-600 dark:text-cyan-300 animate-pulse"
										: isItemError
											? "border-red-500/25 bg-red-500/[0.08] text-red-600 dark:text-red-300"
											: "border-border/70 bg-background text-foreground/55",
								)}
							>
								<Wrench className="h-3.5 w-3.5" />
							</span>
						);
					})}
				</div>
				<div className="min-w-0 flex-1">
					<div
						className={cn(
							"font-semibold uppercase leading-none tracking-[0.1em] text-muted-foreground/70",
							compact ? "text-[10px]" : "text-[11px]",
						)}
					>
						{title}
					</div>
					{subtitle && (
						<div
							className={cn(
								"mt-1 break-words font-mono text-foreground/85",
								compact ? "text-xs" : "text-sm",
							)}
						>
							{truncate(subtitle, compact ? 72 : 120)}
						</div>
					)}
				</div>
				<button
					type="button"
					className={cn(
						"inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
						subtitle && "mt-0.5",
					)}
					onClick={(e) => {
						e.stopPropagation();
						setOpen((v) => !v);
					}}
					aria-label={open ? "Collapse" : "Expand"}
				>
					{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
				</button>
			</div>
			{open && (
				<div
					className={cn(
						"space-y-2 border-t border-border/30 px-3 py-3",
						hasError && "rounded-b-xl",
					)}
				>
					{block.items.map((item, index) => (
						<div key={`tgi-${item.content.slice(0, 15)}-${index}`} className="space-y-1.5">
							<div className="flex items-center gap-2">
								<span
									className={cn(
										"inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
										item.status === "error"
											? "border-red-500/25 bg-red-500/[0.08] text-red-600 dark:text-red-300"
											: item.status === "running"
												? "border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-600 dark:text-cyan-300"
												: "border-border/70 bg-background text-foreground/55",
									)}
								>
									<Wrench className="h-3 w-3" />
								</span>
								<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									{item.label ?? "tool"}
								</span>
								<span
									className={cn(
										"text-[10px] font-semibold uppercase tracking-[0.14em]",
										item.status === "running"
											? "text-cyan-700 dark:text-cyan-300"
											: item.status === "error"
												? "text-red-700 dark:text-red-300"
												: "text-emerald-700 dark:text-emerald-300",
									)}
								>
									{item.status === "running"
										? "Running"
										: item.status === "error"
											? "Errored"
											: "Completed"}
								</span>
							</div>
							<div
								className={cn(
									"pl-7 break-words text-foreground/80",
									compact ? "text-xs" : "text-sm",
								)}
							>
								{item.detail ?? item.content}
							</div>
							{item.expandable && (
								<pre className="ml-7 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-200 bg-zinc-950 rounded-md p-2 max-h-40">
									{item.expandable}
								</pre>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function TranscriptSystemRow({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "system" }>; compact: boolean }) {
	return (
		<div className="flex items-start gap-2">
			<TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-300" />
			<span
				className={cn(
					"break-words text-blue-700 dark:text-blue-300",
					compact ? "text-[11px]" : "text-xs",
				)}
			>
				<span className="text-[10px] font-semibold uppercase tracking-[0.1em]">system</span>
				<span className="ml-2">{block.content}</span>
			</span>
		</div>
	);
}

function TranscriptEventRow({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "event" }>; compact: boolean }) {
	const toneClasses =
		block.tone === "error"
			? "text-red-700 dark:text-red-300"
			: block.tone === "warn"
				? "text-amber-700 dark:text-amber-300"
				: block.tone === "info"
					? "text-sky-700 dark:text-sky-300"
					: "text-foreground/75";

	return (
		<div className={cn("flex items-start gap-2", toneClasses)}>
			{block.tone === "error" ? (
				<CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
			) : (
				<span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current/50" />
			)}
			<div className={cn("whitespace-pre-wrap break-words", compact ? "text-[11px]" : "text-xs")}>
				<span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
					{block.label}
				</span>
				{block.content && <span className="ml-2">{block.content}</span>}
			</div>
		</div>
	);
}

// ── Main component ───────────────────────────────────────────────────

interface RunTranscriptViewProps {
	entries: TranscriptEntry[];
	density?: "comfortable" | "compact";
	limit?: number;
	streaming?: boolean;
	emptyMessage?: string;
	className?: string;
}

export function RunTranscriptView({
	entries,
	density = "comfortable",
	limit,
	streaming = false,
	emptyMessage = "No transcript yet.",
	className,
}: RunTranscriptViewProps) {
	const compact = density === "compact";
	const blocks = useMemo(() => normalizeTranscript(entries, streaming), [entries, streaming]);
	const visibleBlocks = limit ? blocks.slice(-limit) : blocks;

	if (entries.length === 0) {
		return (
			<div
				className={cn(
					"rounded-2xl border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground",
					className,
				)}
			>
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className={cn("space-y-4", className)}>
			{visibleBlocks.map((block, index) => (
				<div
					key={`${block.type}-${index}`}
					className={cn(
						index === visibleBlocks.length - 1 &&
							streaming &&
							"animate-in fade-in slide-in-from-bottom-1 duration-300",
					)}
				>
					{block.type === "text" && <TranscriptTextBlock block={block} compact={compact} />}
					{block.type === "tool" && <TranscriptToolCard item={block} compact={compact} />}
					{block.type === "command_group" && (
						<TranscriptCommandGroup block={block} compact={compact} />
					)}
					{block.type === "tool_group" && <TranscriptToolGroup block={block} compact={compact} />}
					{block.type === "system" && <TranscriptSystemRow block={block} compact={compact} />}
					{block.type === "event" && <TranscriptEventRow block={block} compact={compact} />}
				</div>
			))}
		</div>
	);
}
