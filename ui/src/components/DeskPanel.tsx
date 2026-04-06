import { FlaskConical } from "lucide-react";
import type { Desk, Experiment } from "../lib/api.js";
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
		<>
			{/* Desk header */}
			<div className="px-4 pt-4 pb-3 space-y-3">
				<div className="flex items-center gap-2.5">
					<div className="flex size-7 items-center justify-center rounded-md bg-muted shrink-0">
						<DeskIcon className="size-3.5 text-foreground/70" />
					</div>
					<h2 className="text-sm font-semibold truncate">{desk.name}</h2>
				</div>

				{desk.description && (
					<p className="text-[11px] text-foreground/50 leading-relaxed">{desk.description}</p>
				)}

				{/* Stats + venues — inline */}
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/50">
					<span>${formatUSD(desk.budget)}</span>
					<span className="text-foreground/20">·</span>
					<span className="text-green-600 dark:text-green-400">+{desk.targetReturn}%</span>
					<span className="text-foreground/20">/</span>
					<span className="text-destructive">-{desk.stopLoss}%</span>
					{desk.venues.length > 0 && (
						<>
							<span className="text-foreground/20">·</span>
							{(desk.venues as string[]).map((v) => (
								<Badge key={v} variant="secondary" className="text-[9px] px-1.5 py-0">
									{v}
								</Badge>
							))}
						</>
					)}
				</div>
			</div>

			<Separator />

			{/* Experiments */}
			<div className="px-4 py-2.5">
				<div className="text-[10px] font-medium text-foreground/50 uppercase tracking-widest">
					Experiments
				</div>
			</div>
			<ScrollArea className="flex-1">
				<div className="px-2 space-y-0.5">
					{experiments.map((exp) => (
						<button
							key={exp.id}
							type="button"
							onClick={() => onSelectExperiment(exp.id)}
							className={`w-full text-left px-3 py-2 rounded-md text-[13px] font-medium transition-colors flex items-center gap-2.5 ${
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
				</div>
			</ScrollArea>
		</>
	);
}
