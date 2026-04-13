import {
	Activity,
	Bot,
	Code,
	Database,
	FlaskConical,
	LineChart,
	Play,
	Plus,
	Settings,
	Shield,
	User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import venues from "../../../strategies/venues.json";
import type { Desk, Experiment, Run, Strategy } from "../lib/api.js";
import {
	completeAndCreateNewExperiment,
	getCodeLog,
	listActiveExperiments,
	listDatasets,
	listRuns,
	listStrategies,
} from "../lib/api.js";
import { SidebarNavItem } from "./SidebarNavItem.js";
import { SidebarSection } from "./SidebarSection.js";
import { StatusDot } from "./StatusDot.js";
import { DeskIcon } from "./icons/DeskIcon.js";
import { Badge } from "./ui/badge.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { Separator } from "./ui/separator.js";


export type DeskPage =
	| "experiments"
	| "paper"
	| "runs"
	| "code"
	| "datasets"
	| "activity"
	| "settings";

interface Props {
	desk: Desk;
	experiments: Experiment[];
	selectedExperimentId: string | null;
	activePage: DeskPage;
	onSelectExperiment: (id: string) => void;
	onPageChange: (page: DeskPage) => void;
	onNewExperiment: (newExperiment: Experiment) => void;
}

const teamMembers = [
	{ label: "You — Lead", icon: User, bg: "bg-blue-100 dark:bg-blue-900/40", fg: "text-blue-700 dark:text-blue-300" },
	{ label: "Analyst — Strategy research & backtests", icon: Bot, bg: "bg-purple-100 dark:bg-purple-900/40", fg: "text-purple-700 dark:text-purple-300" },
	{ label: "Risk Manager — Position sizing & risk review", icon: Shield, bg: "bg-orange-100 dark:bg-orange-900/40", fg: "text-orange-700 dark:text-orange-300" },
];

function TeamAvatars() {
	const [hovered, setHovered] = useState<string | null>(null);
	const handlePointerEnter = (label: string) => () => setHovered(label);
	const handlePointerLeave = () => setHovered(null);
	return (
		<div className="relative flex items-center shrink-0 ml-auto" onPointerLeave={handlePointerLeave}>
			{teamMembers.map((m) => (
				<div
					key={m.label}
					className={`flex size-5 items-center justify-center rounded-full ${m.bg} ring-2 ring-background cursor-default transition-transform duration-150 hover:scale-125 hover:z-10`}
					onPointerEnter={handlePointerEnter(m.label)}
				>
					<m.icon className={`size-2.5 ${m.fg}`} />
				</div>
			))}
			{hovered && (
				<div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground pointer-events-none">
					{hovered}
				</div>
			)}
		</div>
	);
}

function formatUSD(value: string | number): string {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	return num.toLocaleString("en-US");
}

function bestReturn(runs: Run[]): number | null {
	const values = runs
		.filter((r) => r.mode !== "paper")
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

	// Track newly-arrived experiment IDs so we can flash a highlight
	// animation in the sidebar when the agent creates a new experiment.
	// Compares the current `experiments` prop against the previous
	// render's snapshot; any ID that wasn't present last time gets a
	// 3-second highlight.
	const prevExpIdsRef = useRef<Set<string>>(new Set(experiments.map((e) => e.id)));
	const [newExpIds, setNewExpIds] = useState<Set<string>>(new Set());
	useEffect(() => {
		const prev = prevExpIdsRef.current;
		const fresh = new Set<string>();
		for (const exp of experiments) {
			if (!prev.has(exp.id)) fresh.add(exp.id);
		}
		prevExpIdsRef.current = new Set(experiments.map((e) => e.id));
		if (fresh.size > 0) {
			setNewExpIds((old) => new Set([...old, ...fresh]));
			const timer = setTimeout(() => {
				setNewExpIds((old) => {
					const next = new Set(old);
					for (const id of fresh) next.delete(id);
					return next;
				});
			}, 3000);
			return () => clearTimeout(timer);
		}
	}, [experiments]);

	const [strategy, setStrategy] = useState<Strategy | null>(null);

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

	// ── Lightweight change detection for Code & Datasets nav items ───
	// Polls dataset count + HEAD commit hash every 10s. First poll
	// sets the baseline; subsequent changes light up a pulsing dot on
	// the sidebar nav item. Visiting the page resets the baseline.
	const [lastSeenDatasetCount, setLastSeenDatasetCount] = useState<number | null>(null);
	const [currentDatasetCount, setCurrentDatasetCount] = useState(0);
	const [lastSeenCommitHash, setLastSeenCommitHash] = useState<string | null>(null);
	const [currentCommitHash, setCurrentCommitHash] = useState<string | null>(null);

	useEffect(() => {
		// Reset baselines on desk switch so the first poll after a switch
		// sets the new baseline without showing a stale dot.
		setLastSeenDatasetCount(null);
		setLastSeenCommitHash(null);

		let cancelled = false;
		const tick = async () => {
			try {
				const [ds, log] = await Promise.all([listDatasets(desk.id), getCodeLog(desk.id)]);
				if (cancelled) return;
				const dsCount = ds.length;
				const headHash = log[0]?.hash ?? null;
				setCurrentDatasetCount(dsCount);
				setCurrentCommitHash(headHash);
				// First poll sets the baseline (no dot until something actually changes)
				setLastSeenDatasetCount((prev) => (prev === null ? dsCount : prev));
				setLastSeenCommitHash((prev) => (prev === null ? headHash : prev));
			} catch {
				/* ignore — keep last known state */
			}
		};
		tick();
		const id = setInterval(tick, 10_000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [desk.id]);

	// Mark as "seen" while the user is on the page
	useEffect(() => {
		if (activePage === "datasets") setLastSeenDatasetCount(currentDatasetCount);
		if (activePage === "code") setLastSeenCommitHash(currentCommitHash);
	}, [activePage, currentDatasetCount, currentCommitHash]);

	const hasDatasetUpdate =
		lastSeenDatasetCount !== null && currentDatasetCount > lastSeenDatasetCount;
	const hasCodeUpdate =
		lastSeenCommitHash !== null &&
		currentCommitHash !== null &&
		currentCommitHash !== lastSeenCommitHash;

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
				<div className="space-y-2">
					<div className="flex items-center gap-2.5">
						<div className="flex size-7 items-center justify-center rounded-md bg-muted shrink-0">
							<DeskIcon className="size-3.5 text-foreground/70" />
						</div>
						<h2 className="text-xs font-semibold flex-1">{desk.name}</h2>
					</div>
					<TeamAvatars />
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
									className={`group relative w-full min-w-0 flex items-center transition-colors ${
										newExpIds.has(exp.id)
											? "animate-pulse bg-blue-100/60 dark:bg-blue-900/30"
											: exp.id === selectedExperimentId
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
										<span className="flex-1 min-w-0 truncate" title={`#${exp.number} ${exp.title}`}>
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
				</div>
			</ScrollArea>

			{/* Paper Trading — pinned above nav */}
			{/* Bottom nav — desk-scoped pages */}
			<div className="shrink-0 border-t border-border px-2 py-2 flex flex-col gap-0.5">
				<SidebarNavItem
					label="Paper Trading"
					icon={Play}
					active={activePage === "paper"}
					onClick={() => onPageChange("paper")}
				/>
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
					hasUpdate={hasCodeUpdate}
					onClick={() => onPageChange("code")}
				/>
				<SidebarNavItem
					label="Datasets"
					icon={Database}
					active={activePage === "datasets"}
					hasUpdate={hasDatasetUpdate}
					onClick={() => onPageChange("datasets")}
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
