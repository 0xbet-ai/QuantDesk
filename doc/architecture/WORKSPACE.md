# Workspace

Each desk gets a git-initialized directory for strategy code and data.

## Structure

```
workspaces/desk-{id}/
  .git/
  strategy.py          # agent writes/modifies strategy code
  config.json          # engine config
  data/                # downloaded market data
    binance_BTC-USDT_5m_2025-01-01_2026-01-01.json
```

## Code Versioning

- Agent commits on every code change, tagged with Run ID
- `commit_hash` on Run record links to exact code version
- UI can show code/diff via comment when user requests

## Data Storage

- Engine downloads data to `workspaces/desk-{id}/data/`
- See `doc/product/DOMAIN_MODEL.md` (Dataset) for schema and reuse model
