import { formatAgentMarkersForDisplay } from "@quantdesk/shared";
import {
	Check,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	Code2,
	TerminalSquare,
	Wrench,
} from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils.js";

// ── Types (matching Paperclip's TranscriptEntry) ─────────────────────

export type TranscriptEntry =
	| { type: "text"; content: string }
	| { type: "thinking"; content: string }
	| { type: "tool_call"; name: string; toolUseId?: string; input: unknown }
	| { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
	| { type: "init"; model: string; sessionId: string }
	| {
			type: "result";
			content: string;
			inputTokens: number;
			outputTokens: number;
			costUsd: number;
			isError: boolean;
	  }
	| { type: "system"; content: string }
	| { type: "stdout"; content: string };

// ── Internal block types ─────────────────────────────────────────────

interface ToolItem {
	name: string;
	toolUseId?: string;
	input: unknown;
	result?: string;
	isError?: boolean;
	status: "running" | "completed" | "error";
}

type TranscriptBlock =
	| { type: "text"; content: string; streaming: boolean }
	| { type: "thinking"; content: string }
	| { type: "tool"; item: ToolItem }
	| { type: "command_group"; items: ToolItem[] }
	| { type: "tool_group"; items: ToolItem[] }
	| { type: "system"; content: string }
	| { type: "stdout"; content: string }
	| { type: "init"; model: string; sessionId: string }
	| {
			type: "result";
			content: string;
			inputTokens: number;
			outputTokens: number;
			costUsd: number;
			isError: boolean;
	  };

// ── Helpers ──────────────────────────────────────────────────────────

function isCommandTool(name: string): boolean {
	const n = name.toLowerCase();
	return n === "bash" || n === "shell" || n === "command_execution";
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function isMcpTool(name: string): boolean {
	return name.startsWith("mcp__");
}

/** Strip the `mcp__<server>__` prefix so cards show `data_fetch` instead of
 *  `mcp__quantdesk__data_fetch`. */
function prettyToolName(name: string): string {
	if (!isMcpTool(name)) return name;
	const parts = name.split("__");
	return parts[parts.length - 1] ?? name;
}

/** Compact one-line summary of an MCP tool's arguments: `key=value, key=value`.
 *  Objects and arrays are JSON-stringified inline with a length cap so the
 *  card header stays readable. */
function summarizeMcpInput(rec: Record<string, unknown>, maxLen: number): string {
	const parts: string[] = [];
	for (const [k, v] of Object.entries(rec)) {
		if (v === undefined || v === null || v === "") continue;
		let rendered: string;
		if (typeof v === "string") rendered = v;
		else if (typeof v === "number" || typeof v === "boolean") rendered = String(v);
		else if (Array.isArray(v)) rendered = `[${v.join(", ")}]`;
		else {
			try {
				rendered = JSON.stringify(v);
			} catch {
				rendered = String(v);
			}
		}
		parts.push(`${k}=${rendered}`);
	}
	return truncate(parts.join(", "), maxLen) || "(no args)";
}

function summarizeToolInput(name: string, input: unknown, maxLen: number): string {
	if (typeof input === "string") return truncate(input, maxLen);
	if (typeof input !== "object" || input === null) return `${name} input`;
	const rec = input as Record<string, unknown>;

	// MCP tools: show every non-empty arg as key=value
	if (isMcpTool(name)) return summarizeMcpInput(rec, maxLen);

	// Bash command
	if (typeof rec.command === "string") {
		return truncate(rec.command, maxLen);
	}
	// File path
	if (typeof rec.file_path === "string") {
		const parts = rec.file_path.split("/");
		return truncate(parts.slice(-2).join("/"), maxLen);
	}
	// Pattern/query
	if (typeof rec.pattern === "string") return truncate(rec.pattern, maxLen);
	if (typeof rec.query === "string") return truncate(rec.query, maxLen);

	const keys = Object.keys(rec);
	if (keys.length === 0) return `${name} (empty)`;
	return truncate(`${keys.length} fields: ${keys.slice(0, 3).join(", ")}`, maxLen);
}

function formatToolPayload(value: unknown): string {
	if (typeof value === "string") {
		try {
			return JSON.stringify(JSON.parse(value), null, 2);
		} catch {
			return value;
		}
	}
	if (value === null || value === undefined) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** Detect language from content for syntax highlighting */
function detectLanguage(content: string, context?: string): string {
	if (
		context === "json" ||
		content.trimStart().startsWith("{") ||
		content.trimStart().startsWith("[")
	)
		return "json";
	if (context === "python" || /\b(import |def |class |print\(|from .+ import)/.test(content))
		return "python";
	if (context === "bash" || /^\$\s|^(cd|ls|pip|npm|python|curl|echo|cat|grep)\b/.test(content))
		return "bash";
	if (/\b(const |let |function |import |export |=>)/.test(content)) return "typescript";
	return "bash";
}

/** Syntax-highlighted code block */
function SyntaxBlock({
	code,
	language,
	className: extraClass,
}: { code: string; language?: string; className?: string }) {
	const lang = language ?? detectLanguage(code);
	return (
		<Highlight theme={themes.oneDark} code={code.trim()} language={lang}>
			{({ style, tokens, getLineProps, getTokenProps }) => (
				<pre
					className={cn(
						"overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] rounded-md p-3 max-h-60",
						extraClass,
					)}
					style={{ ...style, margin: 0, background: "rgb(24 24 27)" }}
				>
					{tokens.map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: prism tokens have no stable key
						<div key={`line-${i}`} {...getLineProps({ line })}>
							{line.map((token, j) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: prism tokens have no stable key
								<span key={`token-${j}`} {...getTokenProps({ token })} />
							))}
						</div>
					))}
				</pre>
			)}
		</Highlight>
	);
}

// ── Normalization ────────────────────────────────────────────────────

function normalizeTranscript(entries: TranscriptEntry[], streaming: boolean): TranscriptBlock[] {
	const blocks: TranscriptBlock[] = [];
	const pendingTools = new Map<string, ToolItem>();
	// Track the most recent background Bash so subsequent BashOutput polls
	// can be absorbed into the same card instead of cluttering the transcript.
	let lastBackgroundBash: ToolItem | null = null;
	// tool_use_ids whose results should be appended to lastBackgroundBash.result
	const absorbedToolIds = new Set<string>();

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

		if (entry.type === "thinking") {
			const last = blocks[blocks.length - 1];
			if (last?.type === "thinking") {
				last.content = entry.content;
			} else {
				blocks.push({ type: "thinking", content: entry.content });
			}
			continue;
		}

		if (entry.type === "tool_call") {
			// Absorb BashOutput polls into the parent background Bash card
			if (entry.name === "BashOutput" && lastBackgroundBash) {
				if (entry.toolUseId) {
					absorbedToolIds.add(entry.toolUseId);
				}
				// Mark parent as still streaming
				lastBackgroundBash.status = "running";
				continue;
			}

			const item: ToolItem = {
				name: entry.name,
				toolUseId: entry.toolUseId,
				input: entry.input,
				status: "running",
			};
			blocks.push({ type: "tool", item });
			if (entry.toolUseId) {
				pendingTools.set(entry.toolUseId, item);
			}

			// Track background Bash for future BashOutput absorption
			const inputObj = entry.input as Record<string, unknown> | null;
			if (
				entry.name === "Bash" &&
				inputObj &&
				typeof inputObj === "object" &&
				inputObj.run_in_background === true
			) {
				lastBackgroundBash = item;
				item.result = "";
			}
			continue;
		}

		if (entry.type === "tool_result") {
			// Append absorbed BashOutput result to the parent Bash card
			if (absorbedToolIds.has(entry.toolUseId) && lastBackgroundBash) {
				const newChunk = entry.content?.trim() ?? "";
				if (newChunk) {
					lastBackgroundBash.result =
						(lastBackgroundBash.result ? `${lastBackgroundBash.result}\n` : "") + newChunk;
				}
				if (entry.isError) {
					lastBackgroundBash.isError = true;
					lastBackgroundBash.status = "error";
				} else {
					// If the chunk indicates the shell exited, mark completed
					if (/exited|completed|finished|done/i.test(newChunk)) {
						lastBackgroundBash.status = "completed";
					}
				}
				absorbedToolIds.delete(entry.toolUseId);
				continue;
			}

			const matched = pendingTools.get(entry.toolUseId);
			if (matched) {
				matched.result = entry.content;
				matched.isError = entry.isError;
				matched.status = entry.isError ? "error" : "completed";
				pendingTools.delete(entry.toolUseId);

				// If this is the foreground result of a background Bash (rare),
				// keep it as the parent for subsequent polls until clearly done.
				if (matched === lastBackgroundBash && entry.isError) {
					lastBackgroundBash = null;
				}
			}
			continue;
		}

		if (entry.type === "init") {
			// Skip duplicate init entries with the same sessionId (resume re-emits init)
			const alreadyHasInit = blocks.some(
				(b) => b.type === "init" && b.sessionId === entry.sessionId,
			);
			if (alreadyHasInit) continue;
			blocks.push({ type: "init", model: entry.model, sessionId: entry.sessionId });
			continue;
		}

		if (entry.type === "result") {
			blocks.push({
				type: "result",
				content: entry.content,
				inputTokens: entry.inputTokens,
				outputTokens: entry.outputTokens,
				costUsd: entry.costUsd,
				isError: entry.isError,
			});
			continue;
		}

		if (entry.type === "system") {
			blocks.push({ type: "system", content: entry.content });
			continue;
		}

		if (entry.type === "stdout") {
			const last = blocks[blocks.length - 1];
			if (last?.type === "stdout") {
				last.content += `\n${entry.content}`;
			} else {
				blocks.push({ type: "stdout", content: entry.content });
			}
		}
	}

	return groupToolBlocks(groupCommandBlocks(blocks));
}

function groupCommandBlocks(blocks: TranscriptBlock[]): TranscriptBlock[] {
	const grouped: TranscriptBlock[] = [];
	let pending: ToolItem[] = [];

	const flush = () => {
		if (pending.length === 0) return;
		if (pending.length === 1) {
			grouped.push({ type: "tool", item: pending[0]! });
		} else {
			grouped.push({ type: "command_group", items: pending });
		}
		pending = [];
	};

	for (const block of blocks) {
		if (block.type === "tool" && isCommandTool(block.item.name)) {
			pending.push(block.item);
		} else {
			flush();
			grouped.push(block);
		}
	}
	flush();
	return grouped;
}

function groupToolBlocks(blocks: TranscriptBlock[]): TranscriptBlock[] {
	const grouped: TranscriptBlock[] = [];
	let pending: ToolItem[] = [];

	const flush = () => {
		if (pending.length === 0) return;
		if (pending.length === 1) {
			grouped.push({ type: "tool", item: pending[0]! });
		} else {
			grouped.push({ type: "tool_group", items: pending });
		}
		pending = [];
	};

	for (const block of blocks) {
		if (block.type === "tool" && !isCommandTool(block.item.name)) {
			pending.push(block.item);
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
	const code = typeof children === "string" ? children : String(children ?? "");
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
			{open && <SyntaxBlock code={code} language={lang} />}
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

const formatAgentMarkers = formatAgentMarkersForDisplay;

function StreamingIndicator() {
	const [seconds, setSeconds] = useState(0);
	const [dotCount, setDotCount] = useState(1);

	useEffect(() => {
		const startedAt = Date.now();
		const tick = setInterval(() => {
			setSeconds(Math.floor((Date.now() - startedAt) / 1000));
		}, 1000);
		const dotTick = setInterval(() => {
			setDotCount((c) => (c % 3) + 1);
		}, 500);
		return () => {
			clearInterval(tick);
			clearInterval(dotTick);
		};
	}, []);

	const label = seconds < 5 ? "Streaming" : seconds < 30 ? "Thinking" : "Working";
	const timeStr = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

	return (
		<div className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-medium italic text-muted-foreground">
			<span className="relative flex h-1.5 w-1.5">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70" />
				<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
			</span>
			<span className="tabular-nums">
				{label}
				{".".repeat(dotCount)}
			</span>
			<span className="text-muted-foreground/60 font-mono not-italic tabular-nums">{timeStr}</span>
		</div>
	);
}

function TextBlock({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "text" }>; compact: boolean }) {
	const content = formatAgentMarkers(block.content);
	return (
		<div>
			<div
				className={cn(
					"text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2 prose-strong:text-foreground",
					compact ? "text-xs" : "text-[13px]",
				)}
			>
				<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
					{content}
				</Markdown>
			</div>
			{block.streaming && <StreamingIndicator />}
		</div>
	);
}

function ThinkingBlock({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "thinking" }>; compact: boolean }) {
	return (
		<div
			className={cn(
				"italic text-foreground/70 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				compact ? "text-[11px] leading-5" : "text-sm leading-6",
			)}
		>
			<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
				{block.content}
			</Markdown>
		</div>
	);
}

function ToolCard({ item, compact }: { item: ToolItem; compact: boolean }) {
	const mcp = isMcpTool(item.name);
	// MCP tool cards default to open so args are visible without a click,
	// matching how Claude Code renders its own tool calls.
	const [open, setOpen] = useState(item.status === "error" || mcp);
	const command = isCommandTool(item.name);
	const displayName = command
		? "Executing command"
		: mcp
			? `MCP · ${prettyToolName(item.name)}`
			: item.name;
	const summary = summarizeToolInput(item.name, item.input, compact ? 72 : 120);

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

	const Icon = command
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
							{displayName}
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
						{summary}
					</div>
				</div>
				<button
					type="button"
					className="mt-0.5 inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
					onClick={() => setOpen((v) => !v)}
				>
					{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
				</button>
			</div>
			{open && (
				<div className="mt-3 space-y-3">
					<div className={cn("grid gap-3", compact ? "grid-cols-1" : "lg:grid-cols-2")}>
						<div>
							<div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
								Input
							</div>
							<SyntaxBlock
								code={formatToolPayload(item.input) || "<empty>"}
								language={detectLanguage(formatToolPayload(item.input), "json")}
							/>
						</div>
						<div>
							<div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
								Result
							</div>
							{item.isError ? (
								<pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] rounded-md p-3 max-h-60 text-red-300 bg-red-950/50">
									{item.result ? formatToolPayload(item.result) : "Waiting for result..."}
								</pre>
							) : (
								<SyntaxBlock
									code={item.result ? formatToolPayload(item.result) : "Waiting for result..."}
								/>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function CommandGroup({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "command_group" }>; compact: boolean }) {
	const [open, setOpen] = useState(false);
	const isRunning = block.items.some((item) => item.status === "running");
	const hasError = block.items.some((item) => item.status === "error");
	const runningItem = [...block.items].reverse().find((item) => item.status === "running");
	const title = isRunning
		? "Executing command"
		: block.items.length === 1
			? "Executed command"
			: `Executed ${block.items.length} commands`;
	const subtitle = runningItem
		? summarizeToolInput(runningItem.name, runningItem.input, compact ? 72 : 120)
		: null;

	return (
		<div
			className={cn(
				open && hasError && "rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3",
			)}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: nested button */}
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
							key={`cmd-${item.toolUseId ?? index}`}
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
							{subtitle}
						</div>
					)}
				</div>
				<span className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground">
					{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
				</span>
			</div>
			{open && (
				<div
					className={cn(
						"mt-3 space-y-3",
						hasError && "rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3",
					)}
				>
					{block.items.map((item, index) => (
						<div key={item.toolUseId ?? `ci-${index}`} className="space-y-2">
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
									{summarizeToolInput(item.name, item.input, compact ? 72 : 120)}
								</span>
							</div>
							{item.result && (
								<div className="ml-7">
									<SyntaxBlock code={item.result} />
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function ToolGroup({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "tool_group" }>; compact: boolean }) {
	const [open, setOpen] = useState(false);
	const isRunning = block.items.some((item) => item.status === "running");
	const hasError = block.items.some((item) => item.status === "error");
	const uniqueNames = [...new Set(block.items.map((item) => item.name))];
	const toolLabel = uniqueNames.length === 1 ? uniqueNames[0]! : `${uniqueNames.length} tools`;
	const title = isRunning
		? `Using ${toolLabel}`
		: block.items.length === 1
			? `Used ${toolLabel}`
			: `Used ${toolLabel} (${block.items.length} calls)`;

	return (
		<div className="rounded-xl border border-border/40 bg-muted/[0.25]">
			{/* biome-ignore lint/a11y/useSemanticElements: nested button */}
			<div
				role="button"
				tabIndex={0}
				className="flex cursor-pointer gap-2 px-3 py-2.5 items-center"
				onClick={() => setOpen((v) => !v)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setOpen((v) => !v);
					}
				}}
			>
				<div className="flex shrink-0 items-center">
					{block.items.slice(0, Math.min(block.items.length, 3)).map((item, index) => (
						<span
							key={item.toolUseId ?? `tg-${index}`}
							className={cn(
								"inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm",
								index > 0 && "-ml-1.5",
								item.status === "running"
									? "border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-600 dark:text-cyan-300 animate-pulse"
									: item.status === "error"
										? "border-red-500/25 bg-red-500/[0.08] text-red-600 dark:text-red-300"
										: "border-border/70 bg-background text-foreground/55",
							)}
						>
							<Wrench className="h-3.5 w-3.5" />
						</span>
					))}
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
				</div>
				<span className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground">
					{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
				</span>
			</div>
			{open && (
				<div
					className={cn(
						"space-y-2 border-t border-border/30 px-3 py-3",
						hasError && "rounded-b-xl",
					)}
				>
					{block.items.map((item, index) => (
						<div key={item.toolUseId ?? `tgi-${index}`} className="space-y-1.5">
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
									{isMcpTool(item.name) ? `MCP · ${prettyToolName(item.name)}` : item.name}
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
									"pl-7 break-words font-mono text-foreground/80",
									compact ? "text-xs" : "text-sm",
								)}
							>
								{summarizeToolInput(item.name, item.input, compact ? 72 : 120)}
							</div>
							{item.result && (
								<div className="ml-7">
									<SyntaxBlock code={item.result} />
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function SystemRow({
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

function StdoutRow({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "stdout" }>; compact: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
			>
				{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				<span>stdout</span>
			</button>
			{open && (
				<pre
					className={cn(
						"mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-foreground/80",
						compact ? "text-[10px] leading-snug" : "text-xs",
					)}
				>
					{block.content}
				</pre>
			)}
		</div>
	);
}

function InitRow({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "init" }>; compact: boolean }) {
	return (
		<div className="flex items-start gap-2 text-sky-700 dark:text-sky-300">
			<span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current/50" />
			<div className={cn("whitespace-pre-wrap break-words", compact ? "text-[11px]" : "text-xs")}>
				<span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
					init
				</span>
				<span className="ml-2">
					model {block.model}
					{block.sessionId && ` · session ${block.sessionId}`}
				</span>
			</div>
		</div>
	);
}

function ResultRow({
	block,
	compact,
}: { block: Extract<TranscriptBlock, { type: "result" }>; compact: boolean }) {
	const toneClasses = block.isError
		? "rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3 text-red-700 dark:text-red-300"
		: "text-sky-700 dark:text-sky-300";

	return (
		<div className={toneClasses}>
			<div className="flex items-start gap-2">
				{block.isError ? (
					<CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
				) : (
					<span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current/50" />
				)}
				<div className="min-w-0 flex-1">
					{block.isError ? (
						<div
							className={cn("whitespace-pre-wrap break-words", compact ? "text-[11px]" : "text-xs")}
						>
							<span className="text-[10px] font-semibold uppercase tracking-[0.1em]">error</span>
							{block.content && <span className="ml-2">{block.content}</span>}
						</div>
					) : (
						<>
							<div
								className={cn(
									"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-sky-700 dark:text-sky-300",
									compact ? "text-[11px] leading-5" : "text-xs leading-5",
								)}
							>
								<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
									{formatAgentMarkers(block.content || "Completed")}
								</Markdown>
							</div>
						</>
					)}
				</div>
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
					{block.type === "text" && <TextBlock block={block} compact={compact} />}
					{block.type === "thinking" && <ThinkingBlock block={block} compact={compact} />}
					{block.type === "tool" && <ToolCard item={block.item} compact={compact} />}
					{block.type === "command_group" && <CommandGroup block={block} compact={compact} />}
					{block.type === "tool_group" && <ToolGroup block={block} compact={compact} />}
					{block.type === "system" && <SystemRow block={block} compact={compact} />}
					{block.type === "stdout" && <StdoutRow block={block} compact={compact} />}
					{block.type === "init" && <InitRow block={block} compact={compact} />}
					{block.type === "result" && <ResultRow block={block} compact={compact} />}
				</div>
			))}
		</div>
	);
}
