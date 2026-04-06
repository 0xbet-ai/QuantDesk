import { useCallback, useEffect, useState } from "react";
import { CommentThread } from "./components/CommentThread.js";
import { CreateDeskWizard } from "./components/CreateDeskWizard.js";
import { DeskPanel } from "./components/DeskPanel.js";
import { Layout } from "./components/Layout.js";
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
		<>
			<Layout
				desks={desks}
				selectedDesk={selectedDesk}
				selectedExperiment={selectedExperiment}
				onSelectDesk={setSelectedDeskId}
				onNewDesk={() => setShowWizard(true)}
				sidebar={
					selectedDesk ? (
						<DeskPanel
							desk={selectedDesk}
							experiments={experiments}
							selectedExperimentId={selectedExperimentId}
							onSelectExperiment={setSelectedExperimentId}
						/>
					) : null
				}
				main={
					selectedExperiment ? (
						<CommentThread experiment={selectedExperiment} />
					) : (
						<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
							Select a desk and experiment to get started
						</div>
					)
				}
				panel={
					selectedExperimentId ? (
						<PropsPanel experiment={selectedExperiment} experimentId={selectedExperimentId} />
					) : (
						<div className="p-3 text-xs text-muted-foreground">No experiment selected</div>
					)
				}
			/>

			{showWizard && (
				<CreateDeskWizard
					onClose={() => setShowWizard(false)}
					onCreated={(deskId) => {
						setShowWizard(false);
						refreshDesks().then(() => setSelectedDeskId(deskId));
					}}
				/>
			)}
		</>
	);
}
