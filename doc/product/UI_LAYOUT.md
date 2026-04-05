# UI Layout

3-column layout:

```
+- col1 -+--- col2 (desk panel) ---+---------- col3 (main) ----------+
|         |                         |                                  |
| + New   | DESK A                  | EXPERIMENT #1 — ADX     Props   |
|         | BTC Trend Following     | Baseline          Status: done  |
| DESKS   | Budget $10K             |                   Runs: 3       |
| Desk A< | Target 15% / Stop -5%   | RUNS              Agent: AN    |
| Desk B  |                         | # St  Return  vs   DD           |
| Desk C  | EXPERIMENTS             | 1 ok  +12.3%  --   -3.1%        |
|         | #1 ADX Baseline  <      | 2 ok  +15.1%  +2.8 -2.8%        |
|         | #2 Timeframe Study      | 3 ..  running...                |
|         |                         |                                  |
| SETTINGS|                         | COMMENTS                         |
| Activity|                         | [user] 5m BTC/USDT backtest     |
| Settings|                         | [analytics] EXECUTED COMMAND >   |
|         |                         | [analytics] Run #1 done.        |
|         |                         |   Return +12.3%, DD -3.1%       |
|         |                         | [user] Add RSI filter p=21      |
|         |                         | [analytics] Run #2 done.        |
|         |                         |   Return +15.1% (+2.8%)         |
|         |                         | +------------------------------+|
|         |                         | | > Type a comment...    [Send]||
|         |                         | +------------------------------+|
+---------+-------------------------+----------------------------------+
```

- **Col 1**: desk list + new desk button + settings nav
- **Col 2**: selected desk config + experiment list (click to select)
- **Col 3**: selected experiment — two zones:
  - **Top (sticky)**: experiment header + properties + run summary table. Always visible.
  - **Bottom (scrollable)**: comment thread + input. Scrolls independently.
- Code/data not shown directly; agent includes analysis in comments. User can request code or data preview via comment.
- Default: most recent experiment selected when no selection
