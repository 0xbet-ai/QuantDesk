import {
	Activity,
	Bot,
	Code,
	FlaskConical,
	LineChart,
	Pause,
	Play,
	Plus,
	Settings,
	Shield,
	User,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import venues from "../../../strategies/venues.json";
import type { Desk, Experiment, PaperSession, Run, Strategy } from "../lib/api.js";
import {
	completeAndCreateNewExperiment,
	getActivePaperSession,
	goPaper,
	listActiveExperiments,
	listRuns,
	listStrategies,
	stopPaperSession,
} from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { SidebarNavItem } from "./SidebarNavItem.js";
import { SidebarSection } from "./SidebarSection.js";
import { StatusDot } from "./StatusDot.js";
import { DeskIcon } from "./icons/DeskIcon.js";
import { Badge } from "./ui/badge.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { Separator } from "./ui/separator.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";

export type DeskPage = "experiments" | "runs" | "code" | "activity" | "settings";

interface Props {
	desk: Desk;
	experiments: Experiment[];
	selectedExperimentId: string | null;
	activePage: DeskPage;
	onSelectExperiment: (id: string) => void;
	onPageChange: (page: DeskPage) => void;
	onNewExperiment: (newExperiment: Experiment) => void;
}

function formatUSD(value: string | number): string {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	return num.toLocaleString("en-US");
}

function bestReturn(runs: Run[]): number | null {
	const values = runs
		.map((r) => r.result?.metrics?.[0]?.value)
		.filter((v): v is number => typeof v === "number");
	if (values.length === 0) return null;
	return Math.max(...values);
}

export function DeskPanel({
	desk,
	experiments,
	selectedExperimentId,
	activePage,
	onSelectExperiment,
	onPageChange,
	onNewExperiment,
}: Props) {
	const [creating, setCreating] = useState(false);

	const handleNewExperiment = async () => {
		if (creating || experiments.length === 0) return;

		setCreating(true);
		try {
			// Use the latest experiment as the "current" to complete.
			// Placeholder title — server will auto-trigger agent to propose a direction,
			// and the agent response will update the title via [EXPERIMENT_TITLE] marker.
			const current = experiments[experiments.length - 1]!;
			const newExp = await completeAndCreateNewExperiment(current.id, {
				title: "New Experiment",
			});
			onNewExperiment(newExp);
		} catch (err) {
			console.error(err);
			window.alert("Failed to create new experiment.");
		} finally {
			setCreating(false);
		}
	};
	const [bestReturns, setBestReturns] = useState<Record<string, number | null>>({});
	const [runningExperiments, setRunningExperiments] = useState<Record<string, boolean>>({});
	const [liveAgentExperiments, setLiveAgentExperiments] = useState<Set<string>>(() => new Set());

	const [strategy, setStrategy] = useState<Strategy | null>(null);
	// Track the best completed backtest run across all experiments (for paper promotion)
	const [bestRun, setBestRun] = useState<Run | null>(null);

	// Paper trading session state
	const [paperSession, setPaperSession] = useState<PaperSession | null>(null);
	const [stoppingPaper, setStoppingPaper] = useState(false);

	const refreshPaper = useCallback(() => {
		getActivePaperSession(desk.id)
			.then(setPaperSession)
			.catch(() => setPaperSession(null));
	}, [desk.id]);

	useEffect(() => {
		refreshPaper();
		const id = setInterval(refreshPaper, 5000);
		return () => clearInterval(id);
	}, [refreshPaper]);

	const [startingPaper, setStartingPaper] = useState(false);
	const [paperError, setPaperError] = useState<string | null>(null);

	const handleStartPaper = async (runId: string) => {
		setStartingPaper(true);
		setPaperError(null);
		try {
			await goPaper(runId);
			refreshPaper();
		} catch (err) {
			setPaperError(err instanceof Error ? err.message : String(err));
		} finally {
			setStartingPaper(false);
		}
	};

	const handleStopPaper = async () => {
		setStoppingPaper(true);
		try {
			await stopPaperSession(desk.id);
			setPaperSession(null);
		} catch (err) {
			console.error("Failed to stop paper session:", err);
		} finally {
			setStoppingPaper(false);
		}
	};

	useEffect(() => {
		if (!desk.strategyId) {
			setStrategy(null);
			return;
		}
		listStrategies()
			.then((all) => {
				setStrategy(all.find((s) => s.id === desk.strategyId) ?? null);
			})
			.catch(() => {});
	}, [desk.strategyId]);

	// Poll the desk's active-agent set so the sidebar can show a live dot on
	// the experiment row whose agent is currently thinking. Lightweight
	// polling beats opening a WebSocket per row.
	useEffect(() => {
		let cancelled = false;
		const tick = () => {
			listActiveExperiments(desk.id)
				.then((ids) => {
					if (!cancelled) setLiveAgentExperiments(new Set(ids));
				})
				.catch(() => {
					/* ignore — keep last known set */
				});
		};
		tick();
		const id = setInterval(tick, 1500);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [desk.id]);

	useEffect(() => {
		for (const exp of experiments) {
			if (bestReturns[exp.id] !== undefined) continue;
			listRuns(exp.id)
				.then((runs) => {
					setBestReturns((prev) => ({ ...prev, [exp.id]: bestReturn(runs) }));
					setRunningExperiments((prev) => ({
						...prev,
						[exp.id]: runs.some((r) => r.status === "running" || r.status === "pending"),
					}));
					// Track overall best completed backtest run for paper promotion
					const completed = runs.filter((r) => r.mode === "backtest" && r.status === "completed");
					for (const run of completed) {
						const val = run.result?.metrics?.[0]?.value;
						if (val != null) {
							setBestRun((prev) => {
								const prevVal = prev?.result?.metrics?.[0]?.value;
								return prevVal == null || val > prevVal ? run : prev;
							});
						}
					}
				})
				.catch(() => {
					setBestReturns((prev) => ({ ...prev, [exp.id]: null }));
				});
		}
	}, [experiments, bestReturns]);

	return (
		<div className="flex flex-col h-full">
			{/* Desk header */}
			<div className="px-4 pt-4 pb-3 space-y-4 shrink-0">
				<div className="flex items-center gap-2.5">
					<div className="flex size-7 items-center justify-center rounded-md bg-muted shrink-0">
						<DeskIcon className="size-3.5 text-foreground/70" />
					</div>
					<h2 className="text-xs font-semibold truncate flex-1">{desk.name}</h2>
					{/* Team avatars */}
					<div className="flex items-center -space-x-1 shrink-0">
						<Tooltip delayDuration={0}>
							<TooltipTrigger asChild>
								<div className="flex size-5 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 ring-2 ring-background transition-transform duration-150 hover:scale-125 hover:z-10">
									<User className="size-2.5 text-blue-700 dark:text-blue-300" />
								</div>
							</TooltipTrigger>
							<TooltipContent side="bottom">You — Lead</TooltipContent>
						</Tooltip>
						<Tooltip delayDuration={0}>
							<TooltipTrigger asChild>
								<div className="flex size-5 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/40 ring-2 ring-background transition-transform duration-150 hover:scale-125 hover:z-10">
									<Bot className="size-2.5 text-purple-700 dark:text-purple-300" />
								</div>
							</TooltipTrigger>
							<TooltipContent side="bottom">Analyst — Strategy research & backtests</TooltipContent>
						</Tooltip>
						<Tooltip delayDuration={0}>
							<TooltipTrigger asChild>
								<div className="flex size-5 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40 ring-2 ring-background transition-transform duration-150 hover:scale-125 hover:z-10">
									<Shield className="size-2.5 text-orange-700 dark:text-orange-300" />
								</div>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								Risk Manager — Position sizing & risk review
							</TooltipContent>
						</Tooltip>
					</div>
				</div>

				{desk.description && (
					<p className="text-xs text-muted-foreground leading-relaxed">{desk.description}</p>
				)}

				{/* Stats */}
				<div className="space-y-1">
					<div className="flex items-center justify-between py-1">
						<span className="text-xs text-muted-foreground">Budget</span>
						<span className="text-xs font-medium">${formatUSD(desk.budget)}</span>
					</div>
					<div className="flex items-center justify-between py-1">
						<span className="text-xs text-muted-foreground">Target</span>
						<span className="text-xs font-medium">+{desk.targetReturn}%</span>
					</div>
					<div className="flex items-center justify-between py-1">
						<span className="text-xs text-muted-foreground">Stop loss</span>
						<span className="text-xs font-medium">-{desk.stopLoss}%</span>
					</div>
				</div>

				{/* Strategy */}
				{(strategy || desk.strategyId) && (
					<div className="flex items-center justify-between">
						<span className="text-xs text-muted-foreground">Strategy</span>
						<span className="text-xs font-medium truncate ml-4">{strategy?.name ?? "Custom"}</span>
					</div>
				)}

				{/* Venues */}
				{desk.venues.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{(desk.venues as string[]).map((v) => {
							const venue = venues.find((ven) => ven.id === v);
							return (
								<Badge key={v} variant="secondary" className="text-[9px]">
									{venue?.name ?? v}
								</Badge>
							);
						})}
					</div>
				)}
			</div>

			<Separator />

			{/* Scrollable middle: Experiments + Paper Trading */}
			<ScrollArea className="flex-1">
				<div className="flex flex-col gap-4 py-2">
					{/* New Experiment button — same style as New Desk */}
					<button
						type="button"
						onClick={handleNewExperiment}
						disabled={creating || experiments.length === 0}
						className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground/70 hover:bg-accent/50 hover:text-foreground transition-colors w-full text-left disabled:opacity-40 disabled:hover:bg-transparent"
					>
						<Plus className="h-4 w-4 shrink-0" />
						<span className="truncate">{creating ? "Creating..." : "New Experiment"}</span>
					</button>

					{/* Experiments */}
					<SidebarSection label="Experiments">
						{experiments.map((exp) => {
							const best = bestReturns[exp.id];
							const isRunning =
								runningExperiments[exp.id] === true || liveAgentExperiments.has(exp.id);
							return (
								<div
									key={exp.id}
									className={`group relative w-full min-w-0 flex items-center ${
										exp.id === selectedExperimentId
											? "bg-accent text-accent-foreground"
											: "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
									}`}
								>
									<button
										type="button"
										onClick={() => onSelectExperiment(exp.id)}
										className="flex-1 min-w-0 text-left px-3 py-2 text-xs font-medium transition-colors flex items-center gap-2.5"
									>
										<FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
										<span
											className="flex-1 min-w-0 truncate"
											title={`#${exp.number} ${exp.title}`}
										>
											#{exp.number} {exp.title}
										</span>
										{best != null && (
											<span
												className={`text-[11px] font-medium shrink-0 ${
													best >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"
												}`}
											>
												{best >= 0 ? "+" : ""}
												{best.toFixed(1)}%
											</span>
										)}
										{isRunning && (
											<span className="flex items-center gap-1.5 shrink-0">
												<StatusDot status="active" />
											</span>
										)}
									</button>
								</div>
							);
						})}
						{experiments.length === 0 && (
							<div className="px-3 py-2 text-xs text-muted-foreground">No experiments yet</div>
						)}
					</SidebarSection>

					{/* Paper Trading */}
					<SidebarSection label="Paper Trading">
						{paperSession && (paperSession.status === "running" || paperSession.status === "pending") ? (
							<div className="px-3 py-2 space-y-2">
								<div className="flex items-center gap-2">
									<span className="relative flex h-2 w-2">
										<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-70" />
										<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
									</span>
									<span className="text-xs font-medium text-green-600 dark:text-green-400">
										{paperSession.status === "pending" ? "Starting…" : "Running"}
									</span>
								</div>
								<div className="text-[11px] text-muted-foreground">
									Started{" "}
									{new Date(paperSession.startedAt).toLocaleString(undefined, {
										month: "short",
										day: "numeric",
										hour: "2-digit",
										minute: "2-digit",
									})}
								</div>
								<button
									type="button"
									onClick={handleStopPaper}
									disabled={stoppingPaper}
									className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
								>
									<Pause className="size-3" />
									{stoppingPaper ? "Stopping…" : "Stop Paper Trading"}
								</button>
							</div>
						) : paperSession && paperSession.status === "failed" ? (
							<div className="px-3 py-2 space-y-1">
								<div className="flex items-center gap-2">
									<span className="h-2 w-2 rounded-full bg-destructive" />
									<span className="text-xs font-medium text-destructive">Failed</span>
								</div>
								<div className="text-[11px] text-muted-foreground truncate" title={paperSession.error ?? undefined}>
									{paperSession.error ?? "Unknown error"}
								</div>
							</div>
						) : bestRun ? (() => {
							const val = bestRun.result?.metrics?.[0]?.value;
							const verdict = bestRun.result?.validation?.verdict;
							const isApproved = verdict === "approve";
							return (
								<div className="px-3 py-2">
									<button
										type="button"
										onClick={
											isApproved
												? () => handleStartPaper(bestRun.id)
												: !verdict
													? () => window.dispatchEvent(new CustomEvent("quantdesk:prefill-chat", { detail: `Run #${bestRun.runNumber} 검증해줘` }))
													: undefined
											}
										disabled={startingPaper || verdict === "reject"}
										title={
											isApproved
												? `Start paper trading with Run #${bestRun.runNumber}`
												: verdict === "reject"
													? "Run was rejected by Risk Manager"
													: "Click to request validation"
										}
										className={cn(
											"flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md transition-colors",
											isApproved
												? "hover:bg-green-500/10 cursor-pointer"
												: verdict === "reject"
													? "cursor-default opacity-50"
													: "hover:bg-muted cursor-pointer",
										)}
									>
										{isApproved ? (
											<div className="flex size-7 items-center justify-center rounded-md bg-green-500/15">
												<Play className="size-3.5 text-green-500" />
											</div>
										) : verdict === "reject" ? (
											<div className="flex size-7 items-center justify-center rounded-md bg-red-500/10">
												<XCircle className="size-3.5 text-red-400" />
											</div>
										) : (
											<div className="flex size-7 items-center justify-center rounded-md bg-muted">
												<Shield className="size-3.5 text-muted-foreground" />
											</div>
										)}
										<div className="flex-1 min-w-0 text-left">
											<div className="text-xs font-medium">
												Run #{bestRun.runNumber}
												{val != null && (
													<span className={cn("ml-1 font-mono", val > 0 ? "text-green-500" : "text-red-500")}>
														{val > 0 ? "+" : ""}{val.toFixed(1)}%
													</span>
												)}
											</div>
											<div className="text-[10px] text-muted-foreground">
												{startingPaper ? "Starting…" : isApproved ? "Ready for paper" : verdict === "reject" ? "Rejected" : "Click to validate"}
											</div>
										</div>
									</button>
									{paperError && (
										<div className="text-[10px] text-red-500 truncate mt-1 px-2.5" title={paperError}>
											{paperError}
										</div>
									)}
								</div>
							);
						})() : (
							<div className="px-3 py-2 text-xs text-muted-foreground">
								No completed runs yet.
							</div>
						)}
					</SidebarSection>
				</div>
			</ScrollArea>

			{/* Bottom nav — desk-scoped pages */}
			<div className="shrink-0 border-t border-border px-2 py-2 flex flex-col gap-0.5">
				<SidebarNavItem
					label="Backtests"
					icon={LineChart}
					active={activePage === "runs"}
					onClick={() => onPageChange("runs")}
				/>
				<SidebarNavItem
					label="Code"
					icon={Code}
					active={activePage === "code"}
					onClick={() => onPageChange("code")}
				/>
				<SidebarNavItem
					label="Activity"
					icon={Activity}
					active={activePage === "activity"}
					onClick={() => onPageChange("activity")}
				/>
				<SidebarNavItem
					label="Settings"
					icon={Settings}
					active={activePage === "settings"}
					onClick={() => onPageChange("settings")}
				/>
			</div>
		</div>
	);
}
