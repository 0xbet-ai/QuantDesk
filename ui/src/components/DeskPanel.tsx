import { Activity, Code, Database, FlaskConical, Plus, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import venues from "../../../strategies/venues.json";
import type { Desk, Experiment, Run, Strategy } from "../lib/api.js";
import { completeAndCreateNewExperiment, listRuns, listStrategies } from "../lib/api.js";
import { SidebarNavItem } from "./SidebarNavItem.js";
import { SidebarSection } from "./SidebarSection.js";
import { StatusDot } from "./StatusDot.js";
import { DeskIcon } from "./icons/DeskIcon.js";
import { Badge } from "./ui/badge.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { Separator } from "./ui/separator.js";

export type DeskPage = "experiments" | "runs" | "datasets" | "code" | "activity" | "settings";

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
	const completed = runs.filter((r) => r.result != null);
	if (completed.length === 0) return null;
	return Math.max(...completed.map((r) => r.result!.returnPct));
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
		const title = window.prompt("New experiment title:", "");
		if (!title || !title.trim()) return;

		setCreating(true);
		try {
			// Use the latest experiment as the "current" to complete
			const current = experiments[experiments.length - 1]!;
			const newExp = await completeAndCreateNewExperiment(current.id, {
				title: title.trim(),
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

	useEffect(() => {
		for (const exp of experiments) {
			if (bestReturns[exp.id] !== undefined) continue;
			listRuns(exp.id)
				.then((runs) => {
					setBestReturns((prev) => ({ ...prev, [exp.id]: bestReturn(runs) }));
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
					<h2 className="text-xs font-semibold truncate">{desk.name}</h2>
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

			{/* Scrollable middle: Experiments + Live */}
			<ScrollArea className="flex-1">
				<div className="flex flex-col gap-4 py-2">
					{/* Experiments */}
					<SidebarSection
						label="Experiments"
						action={
							<button
								type="button"
								onClick={handleNewExperiment}
								disabled={creating || experiments.length === 0}
								className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
								title="New experiment"
							>
								<Plus className="h-3 w-3" />
							</button>
						}
					>
						{experiments.map((exp) => {
							const best = bestReturns[exp.id];
							return (
								<button
									key={exp.id}
									type="button"
									onClick={() => onSelectExperiment(exp.id)}
									className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors flex items-center gap-2.5 ${
										exp.id === selectedExperimentId
											? "bg-accent text-accent-foreground"
											: "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
									}`}
								>
									<FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
									<span className="flex-1 truncate">
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
									<span className="flex items-center gap-1.5 shrink-0">
										<StatusDot status={exp.status} />
									</span>
								</button>
							);
						})}
						{experiments.length === 0 && (
							<div className="px-3 py-2 text-xs text-muted-foreground">No experiments yet</div>
						)}
					</SidebarSection>

					{/* Live */}
					<SidebarSection label="Live">
						<div className="px-3 py-2 text-xs text-muted-foreground">No live runs</div>
					</SidebarSection>
				</div>
			</ScrollArea>

			{/* Bottom nav — desk-scoped pages */}
			<div className="shrink-0 border-t border-border px-2 py-2 flex flex-col gap-0.5">
				<SidebarNavItem
					label="Datasets"
					icon={Database}
					active={activePage === "datasets"}
					onClick={() => onPageChange("datasets")}
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
