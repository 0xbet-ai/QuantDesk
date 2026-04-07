# UI Layout

3-column layout + props panel:

```
+- col1 -+--- col2 (desk) ---+------ col3 (comments) ------+---- props ----+
|         |                   |                              |               |
| + New   | DESK A            | EXPERIMENT #1 — ADX Baseline | Experiment    |
|         | BTC Trend Follow  |                              | Status: ●done |
| DESKS   | Budget $10K       | [user] 5m BTC/USDT backtest  | Runs: 3       |
| Desk A< | Target +15%       | [analyst] EXECUTED CMD >   |               |
| Desk B  | Stop -5%          | [analyst] Run #1 done.     |               |
| Desk C  | binance           |   Return +12.3%, DD -3.1%    |---------------|
|         |                   |                              |               |
|         | EXPERIMENTS       | [user] Add RSI filter p=21   | RUNS          |
|         | #1 ADX Base ●act  | [analyst] Run #2 done.     | #  Ret   DD   |
|         | #2 TF Study ●done |   Return +15.1% (+2.8%)      | 1  +12.3 -3.1 |
|         |                   | [risk_manager] Validated.     | 2  +15.1 -2.8 |
|         | PAPER              |                              | 3  ●paper      |
|         | * BTC paper #1-2   |                              |               |
|         |                   |                              | Run #2 detail |
|---------|                   |                              | vs base +2.8% |
| < ⚙ ☀  |                   |                              | WR 65%        |
|         |                   |                              | 47 trades     |
|         |                   | +----------------------------+|               |
|         |                   | | > Type a comment... [Send] ||  [Start Paper Trading]    |
|         |                   | +----------------------------+|               |
+---------+-------------------+------------------------------+---------------+
```

- **Col 1**: desk list + new desk button. Footer: collapse, settings gear, theme toggle
- **Col 2**: selected desk config + experiment list + paper list
  - PAPER section shows active/stopped paper runs
- **Col 3**: comment thread only + input at bottom. Scrollable.
- **Props panel** (right): context-sensitive, two sections:
  - **Top**: experiment info (status, run count) + run summary table. Click a run to select it.
  - **Bottom**: selected run detail (metrics, delta vs baseline) + [Start Paper Trading] button. Shows warning if not validated by Risk Manager. Empty if no run selected.
- Code/data not shown directly; agent includes analysis in comments
- Default: most recent experiment selected when no selection
