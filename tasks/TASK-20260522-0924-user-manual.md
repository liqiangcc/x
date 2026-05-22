# 梳理使用手册

- Root ID: `TASK-20260522-0924-user-manual`
- Status: `pending`
- Created: `2026-05-22 09:24 CST`
- Source request: `$task-md-workflow:plan-task-md 梳理使用手册`
- Task file: `tasks/TASK-20260522-0924-user-manual.md`

## Objective

梳理并重写本仓库的使用手册，让新使用者能从仓库用途、环境前提、常用数据工作流、代理/API 调用、数据校验、数据库与处理脚本、故障排查和维护约定几个方面快速上手，同时保留现有脚本入口和小范围验证命令，避免把生成数据文件混入文档变更。

## Context

- 现有主要文档是 `README.md` 和 `PROXY_README.md`；`README.md` 当前更偏脚本目录清单，已有代理/API、数据库、Pool -> Codes -> Kline、数据处理等段落。
- 仓库是 script-first 股票数据工作区；核心目录包括 `api/`、`fetch/`、`process/`、`proxy/`、`utils/`、`db/`、`config/`、`data/`、`eastmoney_data/`。
- `AGENTS.md` 明确 `data/pool/<YYYYMMDD>/` 和 `data/kline/{daily,yearly}/` 是生成输出，不应手工编辑，也不应在普通文档提交里混入。
- 常用验证命令包括 `node fetch/pull_pool_task.js --days 0 --output-dir data/pool`、`node utils/parse_pool_json.js data/pool/20260325 --codes-only`、`node fetch/query_pool_klines.js data/pool/20260325 --period daily --limit 10`、`node fetch/check_kline_empty.js data/kline --period daily`、`bash simple_test.sh`。
- 代理文档中提到 Clash 配置位于 `/opt/clash/runtime.yaml`，代理组名为 `lx`，相关脚本依赖 `jq`，并通过 HUP 重载 mihomo/Clash。
- 当前工作区存在大量 `data/kline/`、`data/pool/` 及若干脚本的未提交变更；执行本计划时不要回退或覆盖这些变更，只提交本任务相关文档文件。

## Execution Rules

- Execute subtasks in listed order unless dependencies say otherwise.
- Update this file after each subtask with status, notes, validation, changed files, and commit hash.
- Commit only files related to the completed subtask.
- Do not mark a subtask `done` without validation or a documented reason validation was skipped.

## Tasks

### `TASK-20260522-0924-user-manual-T01` 盘点现有入口与手册结构

- Status: `done`
- Depends on: `none`
- Goal: 明确使用手册要覆盖的真实脚本入口、读者路径和文档结构，形成可落地的大纲。
- Files likely touched: `README.md`, `PROXY_README.md`, `tasks/TASK-20260522-0924-user-manual.md`
- Validation: `rg -n "Pool -> Codes -> Kline|代理|API|数据库|数据处理|故障|维护" README.md PROXY_README.md`

#### Subtasks

##### `TASK-20260522-0924-user-manual-T01-S01` 盘点现有文档和脚本入口

- Status: `done`
- Goal: 收集现有 README、代理文档和主要脚本入口，避免后续手册遗漏真实命令。
- Steps:
  - 阅读 `README.md`、`PROXY_README.md` 和 `AGENTS.md` 中与使用、测试、生成数据相关的说明。
  - 用 `rg --files api fetch process proxy utils db config | sort` 盘点主要脚本和配置文件。
  - 记录需要保留、合并或改写的关键命令，包括代理/API、Pool -> Codes -> Kline、kline 校验、数据库、数据处理。
- Expected files: `tasks/TASK-20260522-0924-user-manual.md`
- Validation: `rg --files api fetch process proxy utils db config | sort` -> passed
- Changed files: `tasks/TASK-20260522-0924-user-manual.md`
- Commit: `807cf9f`
- Notes: 已阅读 `README.md`、`PROXY_README.md` 和 `AGENTS.md`。`README.md` 当前覆盖脚本目录、代理/API、数据库、数据获取、Pool -> Codes -> Kline、kline 校验和数据处理；`PROXY_README.md` 覆盖 Clash/mihomo 代理轮换前提、`/opt/clash/runtime.yaml`、`lx` 代理组、`jq` 依赖和 HUP 重载；`AGENTS.md` 明确生成数据边界和小范围验证习惯。后续手册应保留并重组 `api/call_ttjj_api.sh`、`api/call_api_with_proxy.sh`、`fetch/pull_pool_task.js`、`utils/parse_pool_json.js`、`fetch/query_pool_klines.js`、`fetch/fetch_kline.js`、`fetch/check_kline_empty.js`、`db/init_db.sh`、`db/load_data_to_db.sh`、`db/sql.sh`、`process/statistics.sh`、`process/format_table.sh`、`proxy/proxy_manager.sh`、`proxy/test_and_rotate_proxy.sh` 等入口；避免在文档提交里混入 `data/pool/`、`data/kline/` 生成输出。

##### `TASK-20260522-0924-user-manual-T01-S02` 设计使用手册大纲

- Status: `done`
- Goal: 给 `README.md` 设计面向上手和日常操作的章节顺序。
- Steps:
  - 将 README 结构规划为：项目概览、目录地图、环境与配置、快速开始、常用工作流、代理与 API、数据校验、数据库与处理、故障排查、维护约定。
  - 明确哪些代理细节留在 `PROXY_README.md`，哪些只在 README 中做摘要和跳转。
  - 在任务 Notes 中记录最终大纲和任何取舍。
- Expected files: `tasks/TASK-20260522-0924-user-manual.md`
- Validation: `manual check: 大纲覆盖 README.md 当前已有主要章节，且没有要求新增生成数据` -> passed
- Changed files: `tasks/TASK-20260522-0924-user-manual.md`
- Commit: `f84b5ac`
- Notes: README 建议重组为：1. 项目概览，说明这是股票数据脚本工作区和主要使用场景；2. 目录地图，按 `api/`、`fetch/`、`utils/`、`proxy/`、`db/`、`process/`、`config/`、`data/` 说明职责；3. 环境与配置，列出 Node、Bash、jq、curl、sqlite/AWS/Clash 相关前提和 `config/kline.json`；4. 快速开始，采用小范围 Pool -> Codes -> Kline 路径，强调 `--limit 10` 和生成输出边界；5. 常用工作流，覆盖拉取指定日期/最近交易日 pool、生成 `codes.json`、批量日线/年线、单只 kline、字段平铺查询、kline 巡检；6. 代理与 API，README 只保留直接 API 与代理 API 的选择规则、`DEBUG_MODE`、`DISABLE_PROXY_ROTATION` 和常用命令，并链接到 `PROXY_README.md`；7. 数据库与处理脚本，整理初始化、导入、SQL 查询、统计和格式化入口；8. 验证与巡检，集中列出 `check_kline_empty.js`、`simple_test.sh`、`quick_test.sh`、`batch_test.sh` 等；9. 故障排查，覆盖限流/封禁、代理失败、kline 空或无效 JSON、AWS Lambda 配置失败、数据目录缺失；10. 维护约定，强调小范围运行、生成数据单独提交、改脚本同步 CLI help/README。`PROXY_README.md` 保留代理系统深层细节，包括 `/opt/clash/runtime.yaml`、`lx` 代理组、`jq`、测试/轮换/列出代理、mihomo HUP 重载；README 只做摘要和跳转。

### `TASK-20260522-0924-user-manual-T02` 重写 README 使用手册

- Status: `pending`
- Depends on: `TASK-20260522-0924-user-manual-T01`
- Goal: 将 `README.md` 从脚本清单整理成可执行的使用手册，并保留所有关键命令。
- Files likely touched: `README.md`, `tasks/TASK-20260522-0924-user-manual.md`
- Validation: `bash -n api/call_ttjj_api.sh api/call_api_with_proxy.sh fetch/fetch_all_sectors.sh process/statistics.sh`

#### Subtasks

##### `TASK-20260522-0924-user-manual-T02-S01` 改写项目概览和目录地图

- Status: `done`
- Goal: 让 README 开头说明仓库用途、核心目录、生成数据边界和何时使用哪些脚本族。
- Steps:
  - 重写 README 标题和开头，说明这是股票数据脚本工作区。
  - 保留并压缩目录说明，突出 `api/`、`fetch/`、`process/`、`proxy/`、`utils/`、`db/`、`config/`、`data/`。
  - 明确 `data/pool/<YYYYMMDD>/`、`data/kline/daily/`、`data/kline/yearly/` 是生成输出。
- Expected files: `README.md`
- Validation: `rg -n "script-first|脚本|data/pool|data/kline|api/|fetch/|process/|proxy/|utils/|db/|config/" README.md` -> passed
- Changed files: `README.md`, `tasks/TASK-20260522-0924-user-manual.md`
- Commit: `7b59608`
- Notes: 已将 README 开头从脚本清单改为使用手册入口，增加项目用途、script-first 运行方式、生成数据边界，并按 `api/`、`fetch/`、`utils/`、`proxy/`、`db/`、`process/`、`config/`、`data/` 重写目录地图。后续使用方法章节暂未重排，留给 `T02-S02` 及之后子任务继续整理。

##### `TASK-20260522-0924-user-manual-T02-S02` 补齐快速开始和 Pool 到 Kline 工作流

- Status: `pending`
- Goal: 给出从拉取 pool、生成 codes、批量拉取 kline、检查 kline 的最小可执行路径。
- Steps:
  - 将现有 Pool -> Codes -> Kline 命令整理为快速开始，默认使用小范围命令或 `--limit 10`。
  - 解释 `pull_pool_task.js`、`parse_pool_json.js`、`query_pool_klines.js`、`fetch_kline.js`、`check_kline_empty.js` 的职责边界。
  - 标注默认输出目录和 `--force`、`--period daily/yearly`、`--engine auto`、`--config` 等常用选项。
- Expected files: `README.md`
- Validation: `node utils/parse_pool_json.js data/pool/20260325 --codes-only`
- Commit: `pending`
- Notes: 

##### `TASK-20260522-0924-user-manual-T02-S03` 整理代理与 API 调用章节

- Status: `pending`
- Goal: 让使用者知道何时用直接 API、何时用代理重试，以及常见环境变量如何控制行为。
- Steps:
  - 保留 `api/call_ttjj_api.sh` 和 `api/call_api_with_proxy.sh` 的差异说明。
  - 将 `DEBUG_MODE`、`DISABLE_PROXY_ROTATION` 示例整理为简洁命令块。
  - 增加指向 `PROXY_README.md` 的说明，避免 README 重复代理底层细节。
- Expected files: `README.md`
- Validation: `bash -n api/call_ttjj_api.sh api/call_api_with_proxy.sh proxy/proxy_manager.sh proxy/test_and_rotate_proxy.sh`
- Commit: `pending`
- Notes: 

##### `TASK-20260522-0924-user-manual-T02-S04` 整理数据库、处理脚本和校验章节

- Status: `pending`
- Goal: 把数据库入口、处理脚本和轻量校验命令集中到可查找章节。
- Steps:
  - 整理 `db/init_db.sh`、`db/load_data_to_db.sh`、`db/sql.sh` 的用法和适用场景。
  - 整理 `process/statistics.sh`、`process/format_table.sh` 等处理脚本的入口。
  - 补充常用校验命令：`fetch/check_kline_empty.js`、`simple_test.sh`、`quick_test.sh`、`batch_test.sh`。
- Expected files: `README.md`
- Validation: `bash -n db/init_db.sh db/load_data_to_db.sh db/sql.sh process/statistics.sh process/format_table.sh`
- Commit: `pending`
- Notes: 

### `TASK-20260522-0924-user-manual-T03` 统一代理说明和故障排查

- Status: `pending`
- Depends on: `TASK-20260522-0924-user-manual-T02`
- Goal: 让 README 与 PROXY_README 分工明确，并补齐常见失败场景的处理路径。
- Files likely touched: `README.md`, `PROXY_README.md`, `tasks/TASK-20260522-0924-user-manual.md`
- Validation: `rg -n "DISABLE_PROXY_ROTATION|DEBUG_MODE|/opt/clash/runtime.yaml|lx|jq|mihomo|故障|排查|Troubleshooting" README.md PROXY_README.md`

#### Subtasks

##### `TASK-20260522-0924-user-manual-T03-S01` 精简并对齐 PROXY_README

- Status: `pending`
- Goal: 将代理专门文档整理为 README 的扩展说明，减少重复和过期表述。
- Steps:
  - 阅读 `proxy/` 下脚本的参数和当前 `PROXY_README.md`。
  - 明确代理系统前提：Clash/mihomo 配置、代理组名、`jq`、HUP 重载。
  - 保留测试、轮换、列出代理、禁用轮换的命令。
  - 与 README 中的代理摘要保持术语一致。
- Expected files: `PROXY_README.md`
- Validation: `bash -n proxy/proxy_manager.sh proxy/test_and_rotate_proxy.sh proxy/rotate_proxy.sh proxy/check_proxies.sh`
- Commit: `pending`
- Notes: 

##### `TASK-20260522-0924-user-manual-T03-S02` 补充 README 故障排查与维护约定

- Status: `pending`
- Goal: 记录常见问题处理方式和提交边界，降低误操作数据输出的风险。
- Steps:
  - 增加故障排查：API 被限流或封禁、代理不可用、kline 空文件/无效 JSON、AWS Lambda 配置失败、数据目录缺失。
  - 增加维护约定：优先小范围运行、不要手工改生成 JSON、数据刷新单独提交、改脚本时同步 CLI help 或 README。
  - 给每类问题提供一个检查命令或下一步动作。
- Expected files: `README.md`
- Validation: `rg -n "故障排查|维护约定|限流|空文件|无效 JSON|--limit 10|生成输出|CLI help" README.md`
- Commit: `pending`
- Notes: 

### `TASK-20260522-0924-user-manual-T04` 全文校对和最终验证

- Status: `pending`
- Depends on: `TASK-20260522-0924-user-manual-T03`
- Goal: 验证手册命令、链接和提交范围，确保文档可读且没有混入生成数据。
- Files likely touched: `README.md`, `PROXY_README.md`, `tasks/TASK-20260522-0924-user-manual.md`
- Validation: `git diff -- README.md PROXY_README.md tasks/TASK-20260522-0924-user-manual.md`

#### Subtasks

##### `TASK-20260522-0924-user-manual-T04-S01` 校验命令和 Markdown 可读性

- Status: `pending`
- Goal: 对手册中列出的关键命令做静态或小范围验证，并修正明显不可执行的示例。
- Steps:
  - 对 shell 脚本示例对应文件运行 `bash -n`。
  - 对 Node 示例优先运行不产生大规模网络或数据刷新的命令，如 `node utils/parse_pool_json.js data/pool/20260325 --codes-only` 和 `node fetch/check_kline_empty.js data/kline --period daily`。
  - 人工检查 Markdown 标题层级、命令块、相对路径和中英文术语一致性。
- Expected files: `README.md`, `PROXY_README.md`
- Validation: `manual check: README.md 和 PROXY_README.md 标题层级清晰，命令块可复制，路径均为仓库相对路径或明确的绝对路径`
- Commit: `pending`
- Notes: 

##### `TASK-20260522-0924-user-manual-T04-S02` 检查提交范围并完成任务记录

- Status: `pending`
- Goal: 确保最终提交只包含使用手册相关文件，并在任务文件记录验证与 commit hash。
- Steps:
  - 运行 `git status --short`，识别与本任务无关的既有数据和脚本变更。
  - 仅暂存并提交 `README.md`、`PROXY_README.md` 和本任务文件中已完成状态更新。
  - 在本任务文件记录最终验证命令、结果摘要、变更文件和 commit hash。
- Expected files: `tasks/TASK-20260522-0924-user-manual.md`
- Validation: `git status --short -- README.md PROXY_README.md tasks/TASK-20260522-0924-user-manual.md`
- Commit: `pending`
- Notes: 
