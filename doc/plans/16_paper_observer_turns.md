# 16 — Observer turns while paper runs (TODO)

Spec: `doc/agent/PAPER_LIFECYCLE.md` — the agent wakes for observer turns while a paper session is running.

## Tests first

1. With a `running` session, an observer turn is dispatched on the configured cadence with `role = "analyst"` and the latest `PaperStatus` injected into the prompt.
2. A notable status delta (e.g. drawdown threshold crossed) triggers an immediate observer turn outside the cadence.
3. Observer turns stop the moment the session transitions out of `running`.
4. Observer turns honour the no-dead-end invariant from phase 02.

## Then implement

- Observer scheduler service keyed off active `paperSessions`.
- Delta detector (thresholds defined in `doc/agent/PAPER_LIFECYCLE.md`).
- Resolve the open question from `doc/plans/README.md`: fixed interval vs. event-driven only.
