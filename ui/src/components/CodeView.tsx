import { ChevronRight, FileCode2, FileDiff, GitCommit, History } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "../context/ThemeContext.js";
import type { CommitInfo, Desk } from "../lib/api.js";
import { getCodeDiff, getCodeFile, getCodeFiles, getCodeLog } from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface Props {
	desk: Desk;
}

type ViewMode = "files" | "diff";

function formatRelativeTime(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function langFromPath(path: string): string {
	const ext = path.split(".").pop() ?? "";
	const map: Record<string, string> = {
		py: "python",
		ts: "typescript",
		js: "javascript",
		json: "json",
		yml: "yaml",
		yaml: "yaml",
		md: "markdown",
		sh: "bash",
		csv: "csv",
	};
	return map[ext] ?? "text";
}

// ── Diff parser ──────────────────────────────────────────────────────

interface DiffFile {
	path: string;
	hunks: DiffHunk[];
}

interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

interface DiffLine {
	type: "add" | "del" | "ctx";
	content: string;
	oldNum: number | null;
	newNum: number | null;
}

function parseDiff(raw: string): DiffFile[] {
	const files: DiffFile[] = [];
	const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

	for (const chunk of fileChunks) {
		const lines = chunk.split("\n");
		// Extract file path from "a/path b/path" header
		const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
		const path = headerMatch?.[2] ?? headerMatch?.[1] ?? "unknown";

		const hunks: DiffHunk[] = [];
		let currentHunk: DiffHunk | null = null;
		let oldNum = 0;
		let newNum = 0;

		for (const line of lines.slice(1)) {
			const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
			if (hunkMatch) {
				currentHunk = { header: line, lines: [] };
				hunks.push(currentHunk);
				oldNum = Number.parseInt(hunkMatch[1]!, 10);
				newNum = Number.parseInt(hunkMatch[2]!, 10);
				continue;
			}
			if (!currentHunk) continue;

			if (line.startsWith("+")) {
				currentHunk.lines.push({ type: "add", content: line.slice(1), oldNum: null, newNum });
				newNum++;
			} else if (line.startsWith("-")) {
				currentHunk.lines.push({ type: "del", content: line.slice(1), oldNum, newNum: null });
				oldNum++;
			} else if (line.startsWith(" ") || line === "") {
				currentHunk.lines.push({ type: "ctx", content: line.slice(1), oldNum, newNum });
				oldNum++;
				newNum++;
			}
		}

		if (hunks.length > 0) {
			files.push({ path, hunks });
		}
	}
	return files;
}

// ── Diff renderer ────────────────────────────────────────────────────

function DiffView({ rawDiff }: { rawDiff: string }) {
	const files = useMemo(() => parseDiff(rawDiff), [rawDiff]);

	if (files.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
				No changes in this commit
			</div>
		);
	}

	return (
		<div className="p-4 space-y-6">
			{/* Summary */}
			<div className="text-xs text-muted-foreground">
				{files.length} file{files.length !== 1 ? "s" : ""} changed
			</div>

			{files.map((file) => (
				<div key={file.path} className="border border-border rounded-md overflow-hidden">
					{/* File header */}
					<div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
						<FileDiff className="size-3.5 text-muted-foreground" />
						<span className="text-xs font-mono font-medium">{file.path}</span>
					</div>

					{/* Hunks */}
					<div className="overflow-x-auto">
						<table className="min-w-full text-[12px] leading-5 font-mono border-collapse">
							<tbody>
								{file.hunks.map((hunk, hi) => (
									<HunkRows key={`hunk-${hi}`} hunk={hunk} />
								))}
							</tbody>
						</table>
					</div>
				</div>
			))}
		</div>
	);
}

function HunkRows({ hunk }: { hunk: DiffHunk }) {
	return (
		<>
			<tr>
				<td
					colSpan={3}
					className="px-3 py-1 text-[11px] text-muted-foreground/70 bg-blue-500/[0.04] border-y border-border/30 select-none"
				>
					{hunk.header}
				</td>
			</tr>
			{hunk.lines.map((line, i) => (
				<tr
					key={`${line.oldNum}-${line.newNum}-${i}`}
					className={cn(
						line.type === "add" && "bg-green-500/[0.08]",
						line.type === "del" && "bg-red-500/[0.08]",
					)}
				>
					<td className="w-10 text-right pr-1 select-none text-muted-foreground/40 text-[11px] align-top border-r border-border/20">
						{line.oldNum ?? ""}
					</td>
					<td className="w-10 text-right pr-1 select-none text-muted-foreground/40 text-[11px] align-top border-r border-border/20">
						{line.newNum ?? ""}
					</td>
					<td className="px-3 whitespace-pre">
						<span
							className={cn(
								"select-none mr-2",
								line.type === "add" && "text-green-600 dark:text-green-400",
								line.type === "del" && "text-red-600 dark:text-red-400",
								line.type === "ctx" && "text-muted-foreground/40",
							)}
						>
							{line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
						</span>
						<span
							className={cn(
								line.type === "add" && "text-green-800 dark:text-green-200",
								line.type === "del" && "text-red-800 dark:text-red-200",
							)}
						>
							{line.content}
						</span>
					</td>
				</tr>
			))}
		</>
	);
}

// ── Main component ───────────────────────────────────────────────────

export function CodeView({ desk }: Props) {
	const { theme } = useTheme();
	const [commits, setCommits] = useState<CommitInfo[]>([]);
	const [files, setFiles] = useState<string[]>([]);
	const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [fileContent, setFileContent] = useState<string | null>(null);
	const [diffContent, setDiffContent] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<ViewMode>("diff");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadCommits = useCallback(() => {
		setLoading(true);
		setError(null);
		getCodeLog(desk.id)
			.then((data) => {
				setCommits(data);
				if (data.length > 0 && !selectedCommit) {
					setSelectedCommit(data[0]!.hash);
				}
			})
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, [desk.id, selectedCommit]);

	useEffect(() => {
		loadCommits();
	}, [loadCommits]);

	// Load files for selected commit
	useEffect(() => {
		if (!selectedCommit) return;
		getCodeFiles(desk.id, selectedCommit)
			.then((data) => {
				setFiles(data);
				if (data.length > 0 && !selectedFile) {
					setSelectedFile(data[0]!);
				}
			})
			.catch(() => setFiles([]));
	}, [desk.id, selectedCommit, selectedFile]);

	// Load file content
	useEffect(() => {
		if (viewMode !== "files" || !selectedCommit || !selectedFile) {
			setFileContent(null);
			return;
		}
		setFileContent(null);
		getCodeFile(desk.id, selectedFile, selectedCommit)
			.then(setFileContent)
			.catch(() => setFileContent("// Failed to load file"));
	}, [desk.id, selectedCommit, selectedFile, viewMode]);

	// Load diff for selected commit
	useEffect(() => {
		if (viewMode !== "diff" || !selectedCommit) {
			setDiffContent(null);
			return;
		}
		setDiffContent(null);
		// Find parent commit — diff from parent to selected
		const idx = commits.findIndex((c) => c.hash === selectedCommit);
		const parent = idx >= 0 && idx < commits.length - 1 ? commits[idx + 1]!.hash : null;
		if (!parent) {
			// First commit — show all files as added. Use empty tree hash.
			getCodeDiff(desk.id, "4b825dc642cb6eb9a060e54bf899d15f3f462b1b", selectedCommit)
				.then(setDiffContent)
				.catch(() => setDiffContent(""));
		} else {
			getCodeDiff(desk.id, parent, selectedCommit)
				.then(setDiffContent)
				.catch(() => setDiffContent(""));
		}
	}, [desk.id, selectedCommit, commits, viewMode]);

	const activeCommit = commits.find((c) => c.hash === selectedCommit);

	if (error) {
		return (
			<div className="flex flex-col h-full">
				<div className="px-6 h-12 flex items-center gap-1.5 text-[13px] text-muted-foreground shrink-0 border-b border-border">
					<span>{desk.name}</span>
					<ChevronRight className="size-3" />
					<span className="text-foreground font-medium">Code</span>
				</div>
				<div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
					Workspace not initialized. Run a backtest to create it.
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			{/* Breadcrumb + view toggle */}
			<div className="px-6 h-12 flex items-center gap-1.5 text-[13px] text-muted-foreground shrink-0 border-b border-border">
				<span>{desk.name}</span>
				<ChevronRight className="size-3" />
				<span className="text-foreground font-medium">Code</span>
				{activeCommit && (
					<>
						<ChevronRight className="size-3" />
						<GitCommit className="size-3" />
						<span className="font-mono text-[11px]">{activeCommit.hash.slice(0, 8)}</span>
					</>
				)}
				<div className="flex-1" />
				{/* View toggle */}
				<div className="flex items-center rounded-md border border-border overflow-hidden">
					<button
						type="button"
						onClick={() => setViewMode("diff")}
						className={cn(
							"flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors",
							viewMode === "diff"
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground hover:bg-accent/50",
						)}
					>
						<FileDiff className="size-3" />
						Diff
					</button>
					<button
						type="button"
						onClick={() => setViewMode("files")}
						className={cn(
							"flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-border",
							viewMode === "files"
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground hover:bg-accent/50",
						)}
					>
						<FileCode2 className="size-3" />
						Files
					</button>
				</div>
			</div>

			{loading ? (
				<div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
					Loading...
				</div>
			) : (
				<div className="flex flex-1 min-h-0">
					{/* Left sidebar: commits + files */}
					<div className="w-64 shrink-0 border-r border-border flex flex-col min-h-0">
						{/* Commits section */}
						<div className="px-3 py-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							<History className="size-3" />
							Commits
						</div>
						<div className="max-h-[40%] overflow-y-auto overflow-x-hidden border-b border-border">
							{commits.map((c) => {
								// Extract "run #N" suffix so it can render as a
								// shrink-0 badge pinned to the right edge instead of
								// being hidden by `truncate` on the message line.
								const runMatch = c.message.match(/run #\d+/i);
								const runLabel = runMatch?.[0];
								const messageWithoutRun = runLabel
									? c.message.replace(/\s*·\s*run #\d+/i, "").replace(/\s*run #\d+$/i, "")
									: c.message;
								return (
									<button
										key={c.hash}
										type="button"
										onClick={() => {
											setSelectedCommit(c.hash);
											setSelectedFile(null);
										}}
										className={cn(
											"w-full text-left px-3 py-2 border-b border-border/30 transition-colors",
											c.hash === selectedCommit ? "bg-accent" : "hover:bg-accent/50",
										)}
									>
										<div className="flex items-center gap-1.5 min-w-0">
											<GitCommit className="size-3 text-muted-foreground shrink-0" />
											<span className="text-[11px] font-mono text-muted-foreground">
												{c.hash.slice(0, 7)}
											</span>
											<span className="text-[11px] text-muted-foreground ml-auto shrink-0">
												{formatRelativeTime(c.date)}
											</span>
										</div>
										<div className="flex items-center gap-1.5 mt-0.5 min-w-0">
											<span className="text-xs text-foreground truncate min-w-0 flex-1">
												{messageWithoutRun}
											</span>
											{runLabel && (
												<span className="text-[10px] font-mono text-muted-foreground shrink-0 bg-muted/60 rounded px-1 py-0.5">
													{runLabel}
												</span>
											)}
										</div>
									</button>
								);
							})}
						</div>

						{/* Files section */}
						<div className="px-3 py-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							<FileCode2 className="size-3" />
							Files
						</div>
						<div className="flex-1 overflow-y-auto overflow-x-hidden">
							{files.map((f) => (
								<button
									key={f}
									type="button"
									onClick={() => {
										setSelectedFile(f);
										setViewMode("files");
									}}
									className={cn(
										"w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors",
										f === selectedFile && viewMode === "files"
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
									)}
								>
									{f}
								</button>
							))}
						</div>
					</div>

					{/* Right: diff or file content */}
					<div className="flex-1 min-w-0 overflow-hidden flex flex-col">
						{viewMode === "files" && selectedFile && (
							<div className="px-4 h-10 flex items-center gap-2 text-xs text-muted-foreground border-b border-border shrink-0 bg-muted/30">
								<FileCode2 className="size-3" />
								<span className="font-mono">{selectedFile}</span>
							</div>
						)}
						{viewMode === "diff" && activeCommit && (
							<div className="px-4 h-10 flex items-center gap-2 text-xs text-muted-foreground border-b border-border shrink-0 bg-muted/30">
								<FileDiff className="size-3" />
								<span className="truncate">{activeCommit.message}</span>
							</div>
						)}
						<div className="flex-1 overflow-auto">
							{viewMode === "diff" ? (
								diffContent != null ? (
									<DiffView rawDiff={diffContent} />
								) : (
									<div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
										Loading diff...
									</div>
								)
							) : fileContent != null ? (
								<Highlight
									theme={theme === "dark" ? themes.nightOwl : themes.github}
									code={fileContent}
									language={langFromPath(selectedFile ?? "")}
								>
									{({ style, tokens, getLineProps, getTokenProps }) => (
										<pre
											className="p-4 text-[12px] leading-5 overflow-x-auto"
											style={{ ...style, background: "transparent" }}
										>
											{tokens.map((line, i) => {
												const lineKey = `line-${i.toString()}`;
												return (
													<div key={lineKey} {...getLineProps({ line })}>
														<span className="inline-block w-10 text-right pr-4 select-none text-muted-foreground/40 text-[11px]">
															{i + 1}
														</span>
														{line.map((token, j) => {
															const tokenKey = `${lineKey}-${j.toString()}`;
															return <span key={tokenKey} {...getTokenProps({ token })} />;
														})}
													</div>
												);
											})}
										</pre>
									)}
								</Highlight>
							) : selectedFile ? (
								<div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
									Loading file...
								</div>
							) : (
								<div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
									Select a file to view
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
