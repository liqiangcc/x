---
name: query-limit-up-stocks
description: Query the stocks that hit limit-up for a given trading date from local pool data, especially when the user asks for 涨停股票, zt.json contents, or a limit-up list for a YYYYMMDD date.
---

# Query Limit-Up Stocks

Use this skill when the user wants the limit-up stock list for a specific trading date from local data.

## Workflow

1. Resolve the trading date in `YYYYMMDD` format.
2. Prefer local file `data/pool/<YYYYMMDD>/zt.json`.
3. Run `scripts/query_limit_up.js <YYYYMMDD>` from the repo root.
4. If the current working directory is not the repo root, pass `--base-dir /root/x/data/pool` or another explicit pool directory.
5. Summarize the result with the trading date, total count, and the key fields the user likely cares about:
   `code`, `name`, `price`, `change_pct`, `sector`, `streak_days`, `open_count`, `event_time`.

## Commands

```bash
node scripts/query_limit_up.js 20260325
node scripts/query_limit_up.js 20260325 --json
node scripts/query_limit_up.js 20260325 --limit 20 --sort streak_days
node scripts/query_limit_up.js 20260325 --base-dir /root/x/data/pool
```

## Output Guidance

- Default output is a plain text table for terminal use.
- Use `--json` when the user wants machine-readable output.
- If the date file is missing, say that local data for that date is unavailable and point to `data/pool/<YYYYMMDD>/zt.json` as the expected source.
- Do not browse the web for this skill; it is intended for local pool data.
