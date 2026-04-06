export function assignBaseline(existingRunCount: number): boolean {
	return existingRunCount === 0;
}

export function autoIncrementExperimentNumber(existingCount: number): number {
	return existingCount + 1;
}

interface RunResult {
	returnPct: number;
	drawdownPct: number;
	winRate: number;
}

interface RunDelta {
	returnPctDelta: number;
	drawdownPctDelta: number;
	winRateDelta: number;
}

export function calculateRunDelta(current: RunResult, baseline: RunResult | null): RunDelta | null {
	if (baseline === null) return null;
	return {
		returnPctDelta: current.returnPct - baseline.returnPct,
		drawdownPctDelta: current.drawdownPct - baseline.drawdownPct,
		winRateDelta: current.winRate - baseline.winRate,
	};
}

interface StrategyEntry {
	id: string;
	engine: string;
	name: string;
}

export function filterStrategiesByEngine(
	catalog: StrategyEntry[],
	engine: string | undefined,
): StrategyEntry[] {
	if (!engine) return catalog;
	return catalog.filter((s) => s.engine === engine);
}

interface RunState {
	status: string;
	mode: string;
}

export function validateGoLive(run: RunState): void {
	if (run.mode === "live") {
		throw new Error("Run is already a live run");
	}
	if (run.status !== "completed") {
		throw new Error("Can only go live from a completed backtest run");
	}
}

export function validateStop(run: RunState): void {
	if (run.mode !== "live" || run.status !== "running") {
		throw new Error("Can only stop a running live run");
	}
}
