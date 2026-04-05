# UI Layout

3-column layout:

```
+- col1 -+--- col2 (desk panel) ---+---------- col3 (main) ---------------+- props -+
|         |                         |                                      |         |
| + New   | DESK A                  | EXPERIMENT #1 — ADX Baseline         | Props   |
|         | BTC Trend Following     |                                      | Status  |
| DESKS   | Budget $10K             | RUNS                                 |  done   |
| Desk A< | Target 15% / Stop -5%   | # St  Return  vs   DD               | Runs: 3 |
| Desk B  |                         | 1 ok  +12.3%  --   -3.1%            | Engine  |
| Desk C  | EXPERIMENTS             | 2 ok  +15.1%  +2.8 -2.8% <selected | ft      |
|         | #1 ADX Baseline  <      | 3 ..  running...                     |         |
|         | #2 Timeframe Study      |                                      |---------|
|         |                         | COMMENTS                             | Run #2  |
|         | LIVE                    | [user] 5m BTC/USDT backtest          | +15.1%  |
|         | * BTC/USDT live  #1-2   | [analytics] EXECUTED COMMAND >       | -2.8% DD|
|         |                         | [analytics] Run #1 done.             | 65% WR  |
| SETTINGS|                         |   Return +12.3%, DD -3.1%            | 47 trds |
| Activity|                         | [user] Add RSI filter p=21           |         |
| Settings|                         | [analytics] Run #2 done.             |[Go Live]|
|         |                         |   Return +15.1% (+2.8%)              | Mode:   |
|         |                         | +----------------------------------+ | dry-run |
|         |                         | | > Type a comment...        [Send]| |         |
|         |                         | +----------------------------------+ |         |
+---------+-------------------------+--------------------------------------+---------+
```

- **Col 1**: desk list + new desk button + settings nav
- **Col 2**: selected desk config + experiment list + live list
  - LIVE section shows active/stopped live runs
- **Col 3**: experiment view with two zones:
  - **Top (sticky)**: experiment header + run summary table. Click a run to select it.
  - **Bottom (scrollable)**: comment thread + input
- **Props panel** (right side of col3): context-sensitive properties
  - No run selected: experiment properties (status, run count, engine)
  - Run selected: run metrics (return, drawdown, win rate, trades) + [Go Live] button + mode selector
- Code/data not shown directly; agent includes analysis in comments
- Default: most recent experiment selected when no selection
