/**
 * Active mock scenario selector.
 *
 * Edit `ACTIVE_SCENARIO` below to switch which fixture the mock agent runs.
 * The `MOCK_SCENARIO` env var, if set, still overrides this constant — handy
 * for one-off command-line runs without touching the file.
 *
 * Available fixtures (see `fixtures/mock-agent/`):
 *
 *   happy.py                            — plain text, no markers, slow stream
 *   slow.py                             — long silent stretch (idle card test)
 *   fail.py                             — exits non-zero (failed card test)
 *
 *   marker_propose_data_fetch.py        — PROPOSE_DATA_FETCH proposal card
 *   marker_run_backtest.py              — RUN_BACKTEST engine spawn
 *   marker_dataset.py                   — DATASET registration block
 *   marker_backtest_result.py           — BACKTEST_RESULT metrics block
 *   marker_experiment_title.py          — EXPERIMENT_TITLE rename
 *   marker_propose_validation.py        — PROPOSE_VALIDATION risk_manager handoff
 *   marker_propose_new_experiment.py    — PROPOSE_NEW_EXPERIMENT card
 *   marker_propose_complete_experiment.py — PROPOSE_COMPLETE_EXPERIMENT card
 *   marker_propose_go_paper.py          — PROPOSE_GO_PAPER card
 *   marker_run_paper.py                 — RUN_PAPER session start
 *   marker_rm_approve.py                — RM_APPROVE verdict
 *   marker_rm_reject.py                 — RM_REJECT verdict
 */
export const ACTIVE_SCENARIO = "dispatch.py";
