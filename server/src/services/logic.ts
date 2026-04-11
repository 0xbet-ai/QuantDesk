export function assignBaseline(existingRunCount: number): boolean {
	return existingRunCount === 0;
}

/**
 * Decide whether a NEW backtest should be stamped `is_baseline = true`.
 *
 * The baseline slot belongs to the first **completed** backtest in an
 * experiment — not the first row inserted. Failed runs (engine crashes,
 * 0-trade no-ops, etc.) must NOT capture the slot permanently, otherwise
 * a broken first attempt would lock the experiment out of ever
 * establishing a legitimate baseline and the iteration-budget /
 * Risk Manager sequencing logic (which keys off `is_baseline`) would
 * silently drift.
 *
 * The counter-example `assignBaseline` above is kept for the legacy
 * `createRun` helper that still assumes "first row wins"; new call
 * sites should use this function instead.
 */
export function shouldAssignBaseline(
	existingRuns: ReadonlyArray<{ mode: string; status: string }>,
): boolean {
	return !existingRuns.some((r) => r.mode === "backtest" && r.status === "completed");
}

export function autoIncrementExperimentNumber(existingCount: number): number {
	return existingCount + 1;
}

export function autoIncrementRunNumber(existingCount: number): number {
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

export function validateGoPaper(run: RunState): void {
	if (run.mode === "paper") {
		throw new Error("Run is already a paper trading run");
	}
	if (run.status !== "completed") {
		throw new Error("Can only start paper trading from a completed backtest run");
	}
}

export function validateStop(run: RunState): void {
	if (run.mode !== "paper" || run.status !== "running") {
		throw new Error("Can only stop a running paper trading run");
	}
}
