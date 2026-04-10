import { useCallback, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ActivityView } from "./components/ActivityView.js";
import { CodeView } from "./components/CodeView.js";
import { CommentThread } from "./components/CommentThread.js";
import { CreateDeskWizard } from "./components/CreateDeskWizard.js";
import { GlobalDatasetsView } from "./components/GlobalDatasetsView.js";
import type { DeskPage } from "./components/DeskPanel.js";
import { DeskPanel } from "./components/DeskPanel.js";
import { DeskSettings } from "./components/DeskSettings.js";
import { Layout } from "./components/Layout.js";
import { PaperTradingView } from "./components/PaperTradingView.js";
import { PropsPanel } from "./components/PropsPanel.js";
import { RunDetailView } from "./components/RunDetailView.js";
import { TurnDetailPage } from "./pages/TurnDetailPage.js";
import type { Desk, Experiment } from "./lib/api.js";
import { listDesks, listExperiments } from "./lib/api.js";

interface RouteState {
	desks: Desk[];
	experiments: Experiment[];
	experimentsLoaded: boolean;
	refreshDesks: () => Promise<void>;
	refreshExperiments: () => Promise<void>;
	setShowWizard: (v: boolean) => void;
}

function pageFromPath(path: string): DeskPage {
	if (path.includes("/paper")) return "paper";
	if (path.includes("/code")) return "code";
	if (path.includes("/activity")) return "activity";
	if (path.includes("/settings")) return "settings";
	if (path.includes("/runs")) return "runs";
	return "experiments";
}

function DeskRoute({
	desks,
	experiments,
	experimentsLoaded,
	refreshDesks,
	refreshExperiments,
	setShowWizard,
}: RouteState) {
	const { deskId, expId, runId } = useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const deskPage = pageFromPath(location.pathname);

	const selectedDesk = desks.find((d) => d.id === deskId) ?? null;
	const selectedExperiment = experiments.find((e) => e.id === expId) ?? null;

	// Persist last desk + experiment so a hard refresh restores the same view.
	useEffect(() => {
		if (deskId) localStorage.setItem("quantdesk.lastDeskId", deskId);
	}, [deskId]);
	useEffect(() => {
		if (deskId && expId) {
			localStorage.setItem(`quantdesk.lastExpId.${deskId}`, expId);
		}
	}, [deskId, expId]);

	// Auto-select an experiment if none in URL but experiments exist. Prefer
	// the last one the user viewed for this desk; fall back to the most
	// recent experiment. Runs on every page (not just "experiments") so
	// that navigating to a desk always lands on a concrete experiment.
	useEffect(() => {
		if (!deskId || experiments.length === 0) return;
		// Only auto-select on experiment-centric pages. Non-experiment pages
		// (paper, code, activity, settings) have their own routes and must
		// not be overwritten by an experiment redirect.
		if (deskPage !== "experiments" && deskPage !== "runs") return;
		// No expId in URL, or expId doesn't match any experiment in this desk
		const needsRedirect = !expId || !experiments.find((e) => e.id === expId);
		if (needsRedirect) {
			const lastExpId = localStorage.getItem(`quantdesk.lastExpId.${deskId}`);
			const target =
				experiments.find((e) => e.id === lastExpId) ?? experiments[experiments.length - 1]!;
			navigate(`/desks/${deskId}/experiments/${target.id}`, { replace: true });
		}
	}, [deskId, expId, deskPage, experiments, navigate]);

	const handleSelectDesk = (id: string) => navigate(`/desks/${id}`);
	const handleSelectExperiment = (id: string) => navigate(`/desks/${deskId}/experiments/${id}`);
	const handlePageChange = (page: DeskPage) => {
		if (!deskId) return;
		if (page === "experiments") {
			navigate(expId ? `/desks/${deskId}/experiments/${expId}` : `/desks/${deskId}`);
		} else if (page === "runs") {
			// Runs always live under an experiment. If the URL doesn't
			// already have an expId (e.g. we're on /code), fall back to
			// the latest experiment so the Backtests nav doesn't dead-end.
			const targetExpId = expId ?? experiments[experiments.length - 1]?.id;
			if (targetExpId) {
				navigate(`/desks/${deskId}/experiments/${targetExpId}/runs`);
			} else {
				navigate(`/desks/${deskId}`);
			}
		} else {
			navigate(`/desks/${deskId}/${page}`);
		}
	};
	const handleNewExperiment = (newExp: Experiment) => {
		refreshExperiments().then(() => {
			navigate(`/desks/${deskId}/experiments/${newExp.id}`);
		});
	};
	return (
		<Layout
			desks={desks}
			selectedDesk={selectedDesk}
			selectedExperiment={selectedExperiment}
			onSelectDesk={handleSelectDesk}
			onNewDesk={() => setShowWizard(true)}
			sidebar={
				selectedDesk ? (
					<DeskPanel
						desk={selectedDesk}
						experiments={experiments}
						selectedExperimentId={expId ?? null}
						activePage={deskPage}
						onSelectExperiment={handleSelectExperiment}
						onPageChange={handlePageChange}
						onNewExperiment={handleNewExperiment}
					/>
				) : null
			}
			main={
				selectedDesk && deskPage === "settings" ? (
					<DeskSettings
						desk={selectedDesk}
						onUpdated={() => refreshDesks()}
						onArchived={() => {
							// Clear the remembered desk so HomeRoute's restore
							// effect doesn't bounce straight back to the just-
							// archived desk on its next render.
							localStorage.removeItem("quantdesk.lastDeskId");
							navigate("/");
							refreshDesks();
						}}
					/>
				) : selectedDesk && deskPage === "paper" ? (
					<PaperTradingView desk={selectedDesk} />
				) : selectedDesk && deskPage === "code" ? (
					<CodeView desk={selectedDesk} />
				) : selectedDesk && deskPage === "activity" ? (
					<ActivityView desk={selectedDesk} />
				) : selectedExperiment && deskPage === "runs" ? (
					<RunDetailView
						experiment={selectedExperiment}
						selectedRunId={runId ?? null}
						onBack={() => navigate(`/desks/${deskId}/experiments/${expId}`)}
					/>
				) : selectedDesk && deskPage === "runs" ? (
					<div className="flex-1 flex items-center justify-center text-[13px] text-foreground/50">
						No backtest run
					</div>
				) : selectedExperiment && deskPage === "experiments" ? (
					<CommentThread
						experiment={selectedExperiment}
						onOpenRun={() => navigate(`/desks/${deskId}/experiments/${expId}/runs`)}
					onOpenTurn={(turnId: string) => navigate(`/desks/${deskId}/turns/${turnId}`)}
						onNewExperiment={handleNewExperiment}
						onExperimentUpdated={refreshExperiments}
					/>
				) : selectedDesk ? (
					<div className="flex-1 flex items-center justify-center text-[13px] text-foreground/50">
						{!experimentsLoaded ? "Loading..." : "No experiments yet"}
					</div>
				) : (
					<div className="flex-1 flex items-center justify-center text-[13px] text-foreground/50">
						Select a desk to get started
					</div>
				)
			}
			panel={
				deskPage === "experiments" && expId && selectedDesk ? (
					<PropsPanel experiment={selectedExperiment} experimentId={expId} deskId={selectedDesk.id} />
				) : null
			}
		/>
	);
}

function HomeRoute({
	desks,
	setShowWizard,
}: { desks: Desk[]; setShowWizard: (v: boolean) => void }) {
	const navigate = useNavigate();

	// Restore last desk + experiment from localStorage in one navigation so
	// the user doesn't see a flash of "no experiment" between the two-step
	// restore (HomeRoute -> DeskRoute auto-select).
	useEffect(() => {
		if (desks.length === 0) return;
		const savedDeskId = localStorage.getItem("quantdesk.lastDeskId");
		if (!savedDeskId || !desks.some((d) => d.id === savedDeskId)) return;
		const savedExpId = localStorage.getItem(`quantdesk.lastExpId.${savedDeskId}`);
		const target = savedExpId
			? `/desks/${savedDeskId}/experiments/${savedExpId}`
			: `/desks/${savedDeskId}`;
		navigate(target, { replace: true });
	}, [desks, navigate]);

	return (
		<Layout
			desks={desks}
			selectedDesk={null}
			selectedExperiment={null}
			onSelectDesk={(id) => navigate(`/desks/${id}`)}
			onNewDesk={() => setShowWizard(true)}
			sidebar={null}
			main={
				<div className="flex-1 flex items-center justify-center text-[13px] text-foreground/50">
					Select a desk to get started
				</div>
			}
			panel={null}
		/>
	);
}

export function App() {
	const [desks, setDesks] = useState<Desk[]>([]);
	const [experiments, setExperiments] = useState<Experiment[]>([]);
	const [experimentsLoaded, setExperimentsLoaded] = useState(false);
	const [showWizard, setShowWizard] = useState(false);
	const navigate = useNavigate();
	const location = useLocation();
	// Extract deskId from path like /desks/:deskId/...
	const deskId = location.pathname.match(/^\/desks\/([^/]+)/)?.[1];

	const refreshDesks = useCallback(async () => {
		try {
			const data = await listDesks();
			setDesks(data);
		} catch {
			/* server not running */
		}
	}, []);

	const refreshExperiments = useCallback(async () => {
		if (!deskId) {
			setExperiments([]);
			setExperimentsLoaded(true);
			return;
		}
		try {
			const data = await listExperiments(deskId);
			setExperiments(data);
		} catch {
			/* ignore */
		} finally {
			setExperimentsLoaded(true);
		}
	}, [deskId]);

	// Clear stale experiments when switching to a DIFFERENT desk so the
	// auto-select effect doesn't navigate to an experiment id that
	// belongs to the previous desk. Skips the clear on same-desk
	// refreshes (deskId unchanged) to avoid a flash of "Loading...".
	const prevDeskIdRef = useRef(deskId);
	useEffect(() => {
		if (deskId !== prevDeskIdRef.current) {
			setExperiments([]);
			setExperimentsLoaded(false);
			prevDeskIdRef.current = deskId;
		}
	}, [deskId]);

	useEffect(() => {
		refreshDesks();
	}, [refreshDesks]);

	useEffect(() => {
		refreshExperiments();
	}, [refreshExperiments]);

	const routeState: RouteState = {
		desks,
		experiments,
		experimentsLoaded,
		refreshDesks,
		refreshExperiments,
		setShowWizard,
	};

	return (
		<>
			<Routes>
				<Route path="/" element={<HomeRoute desks={desks} setShowWizard={setShowWizard} />} />
				<Route
					path="/datasets"
					element={
						<Layout
							desks={desks}
							selectedDesk={null}
							selectedExperiment={null}
							onSelectDesk={(id) => navigate(`/desks/${id}`)}
							onNewDesk={() => setShowWizard(true)}
							sidebar={null}
							main={<GlobalDatasetsView />}
							panel={null}
						/>
					}
				/>
				<Route path="/desks" element={<HomeRoute desks={desks} setShowWizard={setShowWizard} />} />
			<Route path="/desks/:deskId" element={<DeskRoute {...routeState} />} />
				<Route path="/desks/:deskId/experiments/:expId" element={<DeskRoute {...routeState} />} />
				<Route
					path="/desks/:deskId/experiments/:expId/runs"
					element={<DeskRoute {...routeState} />}
				/>
				<Route
					path="/desks/:deskId/experiments/:expId/runs/:runId"
					element={<DeskRoute {...routeState} />}
				/>
				<Route path="/desks/:deskId/paper" element={<DeskRoute {...routeState} />} />
			<Route path="/desks/:deskId/code" element={<DeskRoute {...routeState} />} />
				<Route path="/desks/:deskId/activity" element={<DeskRoute {...routeState} />} />
				<Route path="/desks/:deskId/settings" element={<DeskRoute {...routeState} />} />
				<Route path="/desks/:deskId/turns/:turnId" element={<TurnDetailPage />} />
			</Routes>

			{showWizard && (
				<CreateDeskWizard
					onClose={() => setShowWizard(false)}
					onCreated={(newDeskId, newExperimentId) => {
						setShowWizard(false);
						refreshDesks().then(() =>
							navigate(`/desks/${newDeskId}/experiments/${newExperimentId}`),
						);
					}}
				/>
			)}
		</>
	);
}
