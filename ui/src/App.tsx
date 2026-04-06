import { useCallback, useEffect, useState } from "react";
import { CommentThread } from "./components/CommentThread.js";
import { CreateDeskWizard } from "./components/CreateDeskWizard.js";
import { DeskList } from "./components/DeskList.js";
import { DeskPanel } from "./components/DeskPanel.js";
import { PropsPanel } from "./components/PropsPanel.js";
import type { Desk, Experiment } from "./lib/api.js";
import { listDesks, listExperiments } from "./lib/api.js";

export function App() {
	const [desks, setDesks] = useState<Desk[]>([]);
	const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
	const [experiments, setExperiments] = useState<Experiment[]>([]);
	const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
	const [showWizard, setShowWizard] = useState(false);

	const selectedDesk = desks.find((d) => d.id === selectedDeskId) ?? null;
	const selectedExperiment = experiments.find((e) => e.id === selectedExperimentId) ?? null;

	const refreshDesks = useCallback(async () => {
		try {
			const data = await listDesks();
			setDesks(data);
		} catch {
			/* server not running */
		}
	}, []);

	useEffect(() => {
		refreshDesks();
	}, [refreshDesks]);

	useEffect(() => {
		if (!selectedDeskId) {
			setExperiments([]);
			setSelectedExperimentId(null);
			return;
		}
		listExperiments(selectedDeskId)
			.then((data) => {
				setExperiments(data);
				if (data.length > 0) {
					setSelectedExperimentId(data[data.length - 1]!.id);
				}
			})
			.catch(() => {});
	}, [selectedDeskId]);

	return (
		<div className="flex h-screen bg-gray-950 text-gray-100">
			{/* Col 1: Desk List */}
			<div className="w-56 shrink-0 border-r border-gray-800 flex flex-col">
				<div className="p-3 border-b border-gray-800">
					<button
						type="button"
						onClick={() => setShowWizard(true)}
						className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
					>
						+ New Desk
					</button>
				</div>
				<DeskList desks={desks} selectedId={selectedDeskId} onSelect={setSelectedDeskId} />
			</div>

			{/* Col 2: Desk Panel */}
			<div className="w-64 shrink-0 border-r border-gray-800 overflow-y-auto">
				{selectedDesk ? (
					<DeskPanel
						desk={selectedDesk}
						experiments={experiments}
						selectedExperimentId={selectedExperimentId}
						onSelectExperiment={setSelectedExperimentId}
					/>
				) : (
					<div className="p-4 text-gray-500 text-sm">Select a desk</div>
				)}
			</div>

			{/* Col 3: Comments */}
			<div className="flex-1 flex flex-col min-w-0">
				{selectedExperiment ? (
					<CommentThread experiment={selectedExperiment} />
				) : (
					<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
						Select an experiment
					</div>
				)}
			</div>

			{/* Props Panel */}
			<div className="w-64 shrink-0 border-l border-gray-800 overflow-y-auto">
				{selectedExperimentId ? (
					<PropsPanel experiment={selectedExperiment} experimentId={selectedExperimentId} />
				) : null}
			</div>

			{/* Wizard Modal */}
			{showWizard && (
				<CreateDeskWizard
					onClose={() => setShowWizard(false)}
					onCreated={(deskId) => {
						setShowWizard(false);
						refreshDesks().then(() => setSelectedDeskId(deskId));
					}}
				/>
			)}
		</div>
	);
}
