# x 仓库优化改进计划

> 生成日期：2026-06-30  
> 分析对象：`liqiangcc/x`，一个以 Shell/Python 为主的东方财富/天天基金数据抓取、代理轮换、SQLite 入库、统计分析脚本集合。

## 1. 当前仓库画像

仓库已经形成了比较清晰的业务分层：

- `api/`：封装东方财富/天天基金 API，包括行情、板块、股票、ETF、K 线等数据抓取。
- `proxy/`：管理 Clash/mihomo 代理，检测 IP 是否被限流/封禁，并进行代理切换。
- `db/`：SQLite schema、初始化、CSV 导入、ETF 信息与 K 线入库逻辑。
- `fetch/`：业务化的数据拉取入口。
- `process/`、`statistics.py`：数据统计、指标计算、突破新高分析等。
- 根目录：存在若干测试脚本、日志、结果文件、回测样例和临时工具。

整体方向是正确的：先把外部 API 调用抽象出来，再通过数据库沉淀数据，最后做统计/回测。但当前代码仍更像一组快速迭代脚本，离“可维护、可迁移、可自动化运行的数据工程工具”还有明显差距。

## 2. 主要问题与风险

### 2.1 可移植性不足

- 多处硬编码 `/root/x`、`/opt/clash/runtime.yaml`、`stocks.db`、`db/stocks.db`、`mydb.db` 等路径，导致脚本只能在特定机器和特定目录下稳定运行。
- `db/init_db.sh` 使用 `SCHEMA_FILE="database_schema.sql"`，但 schema 实际在 `db/database_schema.sql`，从仓库根目录执行时容易失败。
- `simple_backtest.py` 固定读取 `./002180_d.csv`，不利于复用和自动化测试。

### 2.2 配置、Cookie 与运行环境耦合过重

- API 请求中存在大量固定浏览器 Header、Cookie、固定时间戳和固定日期。
- 代理组名、Clash 配置路径、限流间隔、测试 URL 等散落在脚本内部。
- `.gitignore` 目前只忽略 `db/stocks.db`，但仓库里已经出现多类测试日志和结果文件，后续容易继续污染版本库。

### 2.3 Shell 健壮性不足

- 大量脚本缺少统一的 `set -euo pipefail`、依赖检查、错误处理和退出码约定。
- 存在变量未严格引用、SQL 参数未充分校验、临时文件命名简单、并发执行时可能互相覆盖的问题。
- `db/sql.sh` 过于薄弱，直接把参数传给 `sqlite3`，缺少帮助信息、参数校验和默认数据库路径。

### 2.4 API 调用层重复度高

- `call_ttjj_api.sh` 内部重复了 JSONP 清洗、分页拉取、curl Header、错误处理、等待逻辑。
- `call_api_with_proxy.sh` 和 `call_api_with_rate_limit.sh` 都在做代理/重试/限流相关事情，边界不够清晰。
- 部分逻辑已经混入业务命令，例如 `get_sector_stocks` 会递归调用同一个脚本，随着命令增多会继续膨胀。

### 2.5 数据库与数据质量管理不足

- `db/database_schema.sql` 中 `etf_info` 先 `DROP TABLE IF EXISTS` 再创建，容易在初始化/升级时误删已有数据。
- 缺少 schema 版本管理、迁移脚本和索引规划。
- 增量更新、失败重试、任务进度、数据校验没有形成统一机制。
- `save_ttjj_to_db.py` 已经有批量提交和部分增量逻辑，但还没有把失败记录、重试队列、断点续跑抽象出来。

### 2.6 测试、CI 与质量门禁缺失

- 仓库有多个测试脚本和日志结果，但没有统一的测试入口。
- 未发现 Shell/Python lint、格式化、单元测试、集成测试和 GitHub Actions 工作流。
- 缺少 mock API 响应样本，导致测试可能依赖真实网络、代理状态和外部 API 可用性。

## 3. 优化目标

1. **可迁移**：任意目录 clone 后，通过配置文件或环境变量即可运行，不依赖 `/root/x`。
2. **可维护**：公共路径、日志、HTTP、JSONP、分页、重试、限流、代理逻辑统一封装。
3. **可验证**：每个核心命令有测试；提交前自动执行 shellcheck、shfmt、pytest 或等价检查。
4. **可恢复**：数据抓取任务支持增量、断点续跑、失败重试、失败清单导出。
5. **可运营**：有 README、配置样例、运行手册、常见故障排查和定时任务示例。

## 4. 分阶段改进路线

### 阶段 0：仓库清理与安全基线（优先级 P0）

**目标**：先降低误提交、路径错误和泄露配置的风险。

任务：

- 扩展 `.gitignore`：忽略 `*.log`、`*_results*.txt`、临时输出、SQLite WAL/SHM、`jcodes`、`.env`、缓存目录等。
- 增加 `.env.example`，只保留可公开的配置项示例：
  - `X_PROJECT_ROOT`
  - `X_DB_FILE`
  - `X_CLASH_CONFIG`
  - `X_PROXY_GROUP_NAME`
  - `X_API_TIMEOUT`
  - `X_RATE_LIMIT_DIR`
- 删除或迁移脚本中的 Cookie；确需 Cookie 时只从环境变量或本地未跟踪配置读取。
- 增加 `scripts/check_env.sh` 或 `bin/x doctor`，集中检查 `bash`、`curl`、`jq`、`sqlite3`、`python3`、`shellcheck` 等依赖。
- 修复 `db/init_db.sh` schema 路径问题，使用脚本所在目录定位：`SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)`。

验收标准：

- 在仓库任意目录执行初始化不会因为相对路径失败。
- 新增日志和运行产物不会出现在 `git status`。
- 脚本里不再出现真实 Cookie 值。

### 阶段 1：统一配置、路径和公共函数（优先级 P0/P1）

**目标**：消除硬编码，让脚本可复用、可测试。

建议新增：

```text
scripts/lib/
  config.sh      # 读取环境变量、默认值、项目根目录
  log.sh         # info/warn/error/debug
  http.sh        # curl 封装、超时、重试、JSONP 清洗
  json.sh        # jq 检查、响应结构校验
  sqlite.sh      # db 路径、迁移、查询封装
```

任务：

- 用 `PROJECT_ROOT` 替换所有 `/root/x`。
- 用 `X_CLASH_CONFIG` 替换 `/opt/clash/runtime.yaml`。
- 统一数据库变量为 `X_DB_FILE`，默认 `db/stocks.db`。
- 所有脚本开头统一加载 `scripts/lib/config.sh`。
- 给常用入口增加 `--help`、`--verbose`、`--db`、`--dry-run`。

验收标准：

- `X_PROJECT_ROOT=/tmp/x ./api/call_ttjj_api.sh --help` 能正常工作。
- `DEBUG_MODE=true` 或统一的 `X_DEBUG=1` 能稳定输出调试日志。
- 改动后旧命令仍兼容，至少保留一版兼容入口。

### 阶段 2：重构 API 客户端（优先级 P1）

**目标**：把 API 请求从“大 case 脚本”拆成可维护模块。

建议方向：

- 方案 A：继续使用 Bash，但抽出公共函数。
- 方案 B：将 API 层迁移为 Python 包，Shell 只保留薄入口。

推荐最终目录：

```text
x_client/
  eastmoney.py       # endpoint、参数构造、JSONP 解析
  proxy.py           # 代理选择和限流状态
  storage.py         # SQLite 写入
  cli.py             # argparse/typer 命令行
```

短期可先在 Bash 中实现：

- `request_json url referer`：统一 curl、timeout、重试、错误输出。
- `strip_jsonp`：统一清洗 `cb(...)` 和其他 callback。
- `fetch_paginated endpoint jq_path page_size sleep_seconds`：统一分页合并。
- `build_headers`：只保留必要 Header，移除固定 Cookie。

验收标准：

- `get_sectors`、`get_stocks`、`get_etfs` 的分页逻辑不再重复。
- 所有 API 命令失败时返回结构化错误，stderr 可读，stdout 只输出 JSON。
- API 单元测试可使用本地 fixture，不依赖真实网络。

### 阶段 3：代理与限流系统合并（优先级 P1）

**目标**：让代理检测、轮换、限流只有一个权威实现。

任务：

- 合并 `call_api_with_proxy.sh` 与 `call_api_with_rate_limit.sh` 的职责：
  - 代理可用性检测
  - 每代理调用间隔
  - 失败后切换代理
  - 超时与退避重试
- 从 Clash 配置动态读取代理列表，不再维护硬编码代理名称列表。
- 将 `/tmp/current_proxy_id`、`/tmp/proxy_last_check`、`/tmp/api_rate_limits` 改为可配置目录，并考虑并发锁。
- 使用 `flock` 避免多个抓取任务同时修改 Clash 配置。
- 对 `proxy_manager.sh` 增加 dry-run/test-only 模式，避免测试期间真实改配置。

验收标准：

- 任意 API 调用只通过一个统一入口走代理/限流。
- 并发两个任务不会互相覆盖当前代理状态。
- 代理不可用时有明确错误，不会静默返回空数据。

### 阶段 4：数据库 schema、迁移和数据质量（优先级 P1/P2）

**目标**：保护历史数据，支持长期演进。

任务：

- 引入 `db/migrations/`：
  - `001_init.sql`
  - `002_add_indexes.sql`
  - `003_add_fetch_jobs.sql`
- 移除初始化 schema 中的破坏性 `DROP TABLE IF EXISTS etf_info`。
- 增加元数据表：
  - `schema_migrations(version, applied_at)`
  - `fetch_jobs(id, job_type, target, status, started_at, finished_at, error)`
  - `fetch_failures(job_id, secid, klt, reason, retry_count)`
- 增加必要索引：
  - `klines(secid, klt, timestamp)`
  - `etf_klines(secid, klt, timestamp)`
  - `stocks(stock_code)`
  - `sectors(sector_code)`
- 写入逻辑统一使用事务和批量提交，失败时记录失败清单。

验收标准：

- 重新运行初始化不会删除历史 ETF 信息。
- 入库任务中断后可以根据任务状态继续。
- 每次导入后可输出新增、跳过、失败数量。

### 阶段 5：统计与回测模块产品化（优先级 P2）

**目标**：把一次性分析脚本变成稳定工具。

任务：

- 合并 `process/statistics.sh` 与 `statistics.py` 的重复能力，保留 Python 为主、Shell 为兼容入口。
- 对 `--metric-column` 做白名单校验，避免把任意字符串拼进 SQL。
- 给 `statistics.py` 增加 `--db`、`--format csv/json/table`、`--output`。
- `simple_backtest.py` 增加参数：`--data`、`--cash`、`--from-date`、`--to-date`、`--fast`、`--slow`。
- 增加最小 fixture 数据，保证统计和回测能离线测试。

验收标准：

- 统计命令可指定数据库和输出格式。
- 回测脚本不再依赖固定文件名。
- SQL 注入类风险被测试覆盖。

### 阶段 6：测试、CI 和发布流程（优先级 P1/P2）

**目标**：避免后续改动破坏核心抓取和入库流程。

建议新增：

```text
.github/workflows/ci.yml
Makefile
requirements.txt 或 pyproject.toml
tests/fixtures/
tests/test_statistics.py
tests/test_api_parsing.py
tests/shell/test_cli.bats
```

CI 内容：

- `shellcheck` 检查所有 `.sh`。
- `shfmt -d` 检查格式。
- `python -m compileall .`。
- `pytest` 跑 Python 测试。
- 可选：用 fixture 验证 JSONP 清洗和分页合并。

验收标准：

- Pull Request 或 push 时自动跑基础质量检查。
- API 解析和数据库入库逻辑有离线测试。
- 新增命令需要同时新增测试或 fixture。

## 5. 推荐的目录演进

当前目录可以逐步演进为：

```text
.
├── api/                    # 兼容旧入口，逐步变薄
├── bin/                    # 顶层 CLI，如 bin/x
├── db/
│   ├── migrations/
│   ├── database_schema.sql
│   └── init_db.sh
├── docs/
│   ├── IMPROVEMENT_PLAN.md
│   ├── OPERATIONS.md
│   └── API.md
├── fetch/
├── process/
├── proxy/
├── scripts/lib/            # Shell 公共库
├── tests/
│   ├── fixtures/
│   ├── shell/
│   └── python/
├── x_client/               # 中长期 Python 化目标
├── .env.example
├── .gitignore
├── Makefile
└── README.md
```

## 6. 首批建议提交清单

建议按小步提交，便于回滚和验证：

1. `chore: expand gitignore and add env example`
2. `fix: resolve project root and database paths consistently`
3. `refactor: add shared shell config and logging helpers`
4. `refactor: extract api request and jsonp parsing helpers`
5. `fix: remove destructive table drop from schema initialization`
6. `test: add fixtures for jsonp parsing and statistics`
7. `ci: add shellcheck and pytest workflow`
8. `docs: add operations guide and troubleshooting notes`

## 7. 近期最高收益改动

最建议优先做这五件事：

1. **修路径**：消除 `/root/x` 与相对 schema 路径问题。
2. **清配置**：移除硬编码 Cookie，把 Clash 路径、代理组、数据库路径全部配置化。
3. **补 `.gitignore`**：阻止日志、结果、临时数据继续进入版本库。
4. **统一 API 请求函数**：把 curl/JSONP/分页/错误处理抽出来。
5. **加 CI**：至少先跑 shellcheck、Python 语法检查和离线解析测试。

完成这五项后，仓库的稳定性、可迁移性和后续重构效率会明显提升。