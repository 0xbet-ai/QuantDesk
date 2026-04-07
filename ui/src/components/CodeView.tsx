import { ChevronRight, FileCode2, GitCommit, History } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { useCallback, useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext.js";
import type { CommitInfo, Desk } from "../lib/api.js";
import { getCodeFile, getCodeFiles, getCodeLog } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { ScrollArea } from "./ui/scroll-area.js";

interface Props {
	desk: Desk;
}

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

export function CodeView({ desk }: Props) {
	const { theme } = useTheme();
	const [commits, setCommits] = useState<CommitInfo[]>([]);
	const [files, setFiles] = useState<string[]>([]);
	const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [fileContent, setFileContent] = useState<string | null>(null);
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

	useEffect(() => {
		if (!selectedCommit || !selectedFile) {
			setFileContent(null);
			return;
		}
		setFileContent(null);
		getCodeFile(desk.id, selectedFile, selectedCommit)
			.then(setFileContent)
			.catch(() => setFileContent("// Failed to load file"));
	}, [desk.id, selectedCommit, selectedFile]);

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
			{/* Breadcrumb */}
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
						<ScrollArea className="max-h-[40%] border-b border-border">
							{commits.map((c) => (
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
									<div className="flex items-center gap-1.5">
										<GitCommit className="size-3 text-muted-foreground shrink-0" />
										<span className="text-[11px] font-mono text-muted-foreground">
											{c.hash.slice(0, 7)}
										</span>
										<span className="text-[11px] text-muted-foreground ml-auto shrink-0">
											{formatRelativeTime(c.date)}
										</span>
									</div>
									<div className="text-xs text-foreground mt-0.5 truncate">{c.message}</div>
								</button>
							))}
						</ScrollArea>

						{/* Files section */}
						<div className="px-3 py-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							<FileCode2 className="size-3" />
							Files
						</div>
						<ScrollArea className="flex-1">
							{files.map((f) => (
								<button
									key={f}
									type="button"
									onClick={() => setSelectedFile(f)}
									className={cn(
										"w-full text-left px-3 py-1.5 text-xs font-mono transition-colors",
										f === selectedFile
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
									)}
								>
									{f}
								</button>
							))}
						</ScrollArea>
					</div>

					{/* Right: file content */}
					<div className="flex-1 min-w-0 flex flex-col">
						{selectedFile && (
							<div className="px-4 h-10 flex items-center gap-2 text-xs text-muted-foreground border-b border-border shrink-0 bg-muted/30">
								<FileCode2 className="size-3" />
								<span className="font-mono">{selectedFile}</span>
							</div>
						)}
						<ScrollArea className="flex-1">
							{fileContent != null ? (
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
						</ScrollArea>
					</div>
				</div>
			)}
		</div>
	);
}
