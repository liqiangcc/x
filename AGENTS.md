# Repository Guidelines

## Project Structure & Module Organization
This repository is a script-first stock data workspace. Core automation lives in `api/`, `fetch/`, `process/`, `proxy/`, and `utils/`. Database helpers and schema files are in `db/`, runtime configuration is in `config/`, and generated datasets live under `data/` and `eastmoney_data/`. Treat `data/pool/<YYYYMMDD>/` and `data/kline/{daily,yearly}/` as outputs, not hand-edited source files.

## Build, Test, and Development Commands
There is no single build step; contributors usually run scripts directly from the repo root.

```bash
node fetch/pull_pool_task.js --days 0 --output-dir data/pool
node utils/parse_pool_json.js data/pool/20260325 --codes-only
node fetch/query_pool_klines.js data/pool/20260325 --period daily --limit 10
node fetch/check_kline_empty.js data/kline --period daily
bash simple_test.sh
```

Use `call_ttjj_api.sh` for fast direct API calls and `call_api_with_proxy.sh` when retries and proxy rotation matter. Prefer small-scope runs such as `--limit 10` before regenerating large datasets.

## Coding Style & Naming Conventions
Follow the existing style in each language: JavaScript uses CommonJS, semicolons, double quotes, and 2-space indentation; shell scripts use Bash with 4-space indentation inside functions and uppercase environment variables like `DEBUG_MODE`. Name new scripts by action, e.g. `fetch_*.js`, `*_to_db.sh`, `generate_*.js`. Keep CLI help text current when adding flags.

## Testing Guidelines
There is no formal test framework or coverage gate in this repo. Validate changes with targeted script runs and keep outputs inspectable. Use `fetch/check_kline_empty.js` for JSON integrity, and the existing smoke scripts such as `simple_test.sh`, `quick_test.sh`, or `batch_test.sh` for API-path checks. Do not mix unrelated regenerated JSON files into a code change unless the data refresh is intentional.

## Commit & Pull Request Guidelines
Recent history favors short, scoped subjects like `docs: add pool-to-kline workflow` and `data: add pool snapshots and generated kline files`. Keep commits focused and prefix them by area when possible: `docs:`, `fetch:`, `build:`, `data:`. PRs should state the workflow changed, list commands used for validation, and call out any generated files or config changes. Include sample output or screenshots only when they clarify behavior.
