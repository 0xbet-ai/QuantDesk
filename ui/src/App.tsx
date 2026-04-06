import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityView } from "./components/ActivityView.js";
import { CommentThread } from "./components/CommentThread.js";
import { CreateDeskWizard } from "./components/CreateDeskWizard.js";
import type { DeskPage } from "./components/DeskPanel.js";
import { DeskPanel } from "./components/DeskPanel.js";
import { DeskSettings } from "./components/DeskSettings.js";
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
	const [deskPage, setDeskPage] = useState<DeskPage>("experiments");

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
		setDeskPage("experiments");
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
							activePage={deskPage}
							onSelectExperiment={(id) => {
								setSelectedExperimentId(id);
								setDeskPage("experiments");
							}}
							onPageChange={setDeskPage}
						/>
					) : null
				}
				main={
					selectedDesk && deskPage === "settings" ? (
						<DeskSettings
							desk={selectedDesk}
							onUpdated={() => refreshDesks()}
							onArchived={() => {
								setSelectedDeskId(null);
								refreshDesks();
							}}
						/>
					) : selectedDesk && deskPage === "activity" ? (
						<ActivityView desk={selectedDesk} />
					) : selectedExperiment && deskPage === "experiments" ? (
						<CommentThread experiment={selectedExperiment} />
					) : selectedDesk && deskPage !== "experiments" ? (
						<div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
							{deskPage.charAt(0).toUpperCase() + deskPage.slice(1)} — coming soon
						</div>
					) : (
						<div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
							Select a desk and experiment to get started
						</div>
					)
				}
				panel={
					deskPage === "experiments" && selectedExperimentId ? (
						<PropsPanel experiment={selectedExperiment} experimentId={selectedExperimentId} />
					) : null
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
