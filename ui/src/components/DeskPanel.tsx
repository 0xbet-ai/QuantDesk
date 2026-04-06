import { Activity, Code, Database, FlaskConical, Settings } from "lucide-react";
import type { Desk, Experiment } from "../lib/api.js";
import { SidebarNavItem } from "./SidebarNavItem.js";
import { SidebarSection } from "./SidebarSection.js";
import { StatusDot } from "./StatusDot.js";
import { DeskIcon } from "./icons/DeskIcon.js";
import { Badge } from "./ui/badge.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { Separator } from "./ui/separator.js";

interface Props {
	desk: Desk;
	experiments: Experiment[];
	selectedExperimentId: string | null;
	onSelectExperiment: (id: string) => void;
}

function formatUSD(value: string | number): string {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	return num.toLocaleString("en-US");
}

export function DeskPanel({ desk, experiments, selectedExperimentId, onSelectExperiment }: Props) {
	return (
		<div className="flex flex-col h-full">
			{/* Desk header */}
			<div className="px-4 pt-4 pb-3 space-y-4 shrink-0">
				<div className="flex items-center gap-2.5">
					<div className="flex size-7 items-center justify-center rounded-md bg-muted shrink-0">
						<DeskIcon className="size-3.5 text-foreground/70" />
					</div>
					<h2 className="text-sm font-semibold truncate">{desk.name}</h2>
				</div>

				{desk.description && (
					<p className="text-[11px] text-foreground/50 leading-relaxed">{desk.description}</p>
				)}

				{/* Stats */}
				<div className="space-y-2 text-[11px]">
					<div className="flex justify-between">
						<span className="text-foreground/40">Budget</span>
						<span className="text-foreground/70">${formatUSD(desk.budget)}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-foreground/40">Target</span>
						<span className="text-green-600 dark:text-green-400">+{desk.targetReturn}%</span>
					</div>
					<div className="flex justify-between">
						<span className="text-foreground/40">Stop loss</span>
						<span className="text-destructive">-{desk.stopLoss}%</span>
					</div>
				</div>

				{/* Venues */}
				{desk.venues.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{(desk.venues as string[]).map((v) => (
							<Badge key={v} variant="secondary" className="text-[9px]">
								{v}
							</Badge>
						))}
					</div>
				)}
			</div>

			<Separator />

			{/* Scrollable middle: Experiments + Live */}
			<ScrollArea className="flex-1">
				<div className="flex flex-col gap-4 py-2">
					{/* Experiments */}
					<SidebarSection label="Experiments">
						{experiments.map((exp) => (
							<button
								key={exp.id}
								type="button"
								onClick={() => onSelectExperiment(exp.id)}
								className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2.5 ${
									exp.id === selectedExperimentId
										? "bg-accent text-accent-foreground"
										: "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
								}`}
							>
								<FlaskConical className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
								<span className="flex-1 truncate">
									#{exp.number} {exp.title}
								</span>
								<span className="ml-auto flex items-center gap-1.5 shrink-0">
									<StatusDot status={exp.status} />
									<span className="text-[11px] text-foreground/50">{exp.status}</span>
								</span>
							</button>
						))}
						{experiments.length === 0 && (
							<div className="px-3 py-2 text-sm text-muted-foreground">No experiments yet</div>
						)}
					</SidebarSection>

					{/* Live */}
					<SidebarSection label="Live">
						<div className="px-3 py-2 text-sm text-muted-foreground">No live runs</div>
					</SidebarSection>
				</div>
			</ScrollArea>

			{/* Bottom nav — desk-scoped pages */}
			<div className="shrink-0 border-t border-border px-2 py-2 flex flex-col gap-0.5">
				<SidebarNavItem label="Datasets" icon={Database} />
				<SidebarNavItem label="Code" icon={Code} />
				<SidebarNavItem label="Activity" icon={Activity} />
				<SidebarNavItem label="Settings" icon={Settings} />
			</div>
		</div>
	);
}
