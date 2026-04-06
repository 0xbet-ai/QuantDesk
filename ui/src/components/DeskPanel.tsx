import type { Desk, Experiment } from "../lib/api.js";

interface Props {
	desk: Desk;
	experiments: Experiment[];
	selectedExperimentId: string | null;
	onSelectExperiment: (id: string) => void;
}

export function DeskPanel({ desk, experiments, selectedExperimentId, onSelectExperiment }: Props) {
	return (
		<div className="p-3">
			<h2 className="font-semibold text-sm truncate">{desk.name}</h2>
			{desk.description && (
				<p className="text-xs text-gray-400 mt-1 truncate">{desk.description}</p>
			)}
			<div className="mt-3 space-y-1 text-xs text-gray-400">
				<div>Budget ${desk.budget}</div>
				<div>Target {desk.targetReturn}%</div>
				<div>Stop -{desk.stopLoss}%</div>
			</div>

			<div className="mt-4">
				<div className="text-xs font-semibold text-gray-500 uppercase mb-1">Experiments</div>
				{experiments.map((exp) => (
					<button
						key={exp.id}
						type="button"
						onClick={() => onSelectExperiment(exp.id)}
						className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-gray-800 ${
							exp.id === selectedExperimentId ? "bg-gray-800 text-white" : "text-gray-300"
						}`}
					>
						#{exp.number} {exp.title}
					</button>
				))}
			</div>
		</div>
	);
}
