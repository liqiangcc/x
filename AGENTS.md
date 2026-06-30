# Repository Guidelines

## Project Structure & Module Organization
This repository is a Node.js-first stock data ledger workspace. Core automation lives in `bin/x`, `src/`, `api/`, `fetch/`, and `utils/`. Database helpers and schema files are in `db/`, runtime configuration is in `config/`, and generated datasets live under `data/` and `eastmoney_data/`. Treat `data/pool/<YYYYMMDD>/` and `data/kline/{daily,yearly}/` as outputs, not hand-edited source files. Legacy Python and Shell scripts live under `legacy/` and are not recommended entrypoints.

## Build, Test, and Development Commands
There is no single build step; contributors usually run scripts directly from the repo root.

```bash
bin/x doctor
bin/x daily --latest --limit 10 --period daily
bin/x kline validate data/kline --period daily --json
npm run check
npm test
```

Use `api/call_ttjj_api.js` for direct API calls and `bin/x proxy ...` for proxy configuration tasks. Prefer small-scope runs such as `--limit 10` before regenerating large datasets.

## Coding Style & Naming Conventions
Follow the existing Node.js style: CommonJS, semicolons, double quotes, and 2-space indentation. Name new scripts by action, e.g. `fetch_*.js` and `generate_*.js`. Keep CLI help text current when adding flags.

## Testing Guidelines
Use Node's built-in test runner for unit tests and keep outputs inspectable. Use `fetch/check_kline_empty.js` or `bin/x kline validate` for JSON integrity. Do not mix unrelated regenerated JSON files into a code change unless the data refresh is intentional.

## Commit & Pull Request Guidelines
Recent history favors short, scoped subjects like `docs: add pool-to-kline workflow` and `data: add pool snapshots and generated kline files`. Keep commits focused and prefix them by area when possible: `docs:`, `fetch:`, `build:`, `data:`. PRs should state the workflow changed, list commands used for validation, and call out any generated files or config changes. Include sample output or screenshots only when they clarify behavior.
