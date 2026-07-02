# x 仓库价值导向重构方案

> 日期：2026-06-30  
> 目标：把 `x` 重构为一个 **代码、数据、运行记录、报告统一版本化** 的 A 股数据与信号研究仓库。  
> 核心原则：Git 仓库就是数据账本，GitHub Actions 是自动采集、校验、提交和记录提交信息的执行器。

## 1. 重新定位：Repo-as-Data-Ledger

`x` 不应只是一个脚本目录，也不应默认依赖 S3 / R2 / OSS / NAS 这类外部存储。更适合当前项目的定位是：

```text
Git 仓库 = 代码 + 数据 + 运行记录 + 报告 的统一账本
GitHub Actions = 自动采集、校验、提交、记录 commit message 的执行器
```

这样做的价值是：

1. 每天的数据状态可以通过 Git 历史追溯。
2. 每次采集都有明确 commit message。
3. 可以按日期、股票代码、run_id 查询历史。
4. 可以用 `git diff` 查看 pool、codes、kline、report 的变化。
5. 不依赖外部对象存储，也不依赖某台本地机器保存唯一数据。
6. 数据、质量报告、失败项、候选结果都能和代码版本绑定。

因此，本次重构目标不是“把脚本写整洁”，而是：

```text
每天稳定产出可信数据、可解释信号、候选股票报告，并把这些结果以可维护的 Git 提交记录保存下来。
```

## 2. 核心使用场景

围绕每个交易日执行一条主线：

```text
Pool 数据
  -> 股票代码池 codes
  -> 日线 / 年线 Kline
  -> 数据质量校验
  -> 信号计算 / 策略研究
  -> 每日候选股与研究报告
  -> 自动提交到仓库
```

理想命令是：

```bash
x daily --latest --commit
```

内部展开为：

```bash
x pool pull --latest
x codes build data/pool/<date>
x kline sync data/pool/<date> --period daily
x kline validate --period daily
x signal run --date <date>
x report daily --date <date>
x git commit-data --date <date>
```

最终在仓库中留下：

```text
data/pool/<date>/
data/kline/<period>/...
runs/<run_id>/
reports/<date>/
```

以及一条或多条结构化提交信息。

## 3. 当前新增内容带来的关键变化

当前 `master` 已经出现了一条新的 Node.js 主线：

```text
fetch/pull_pool_task.js
utils/parse_pool_json.js
fetch/query_pool_klines.js
fetch/fetch_kline.js
fetch/check_kline_empty.js
```

这条主线已经具备：

1. 拉取指定日期或最近交易日的 pool 数据。
2. 从 pool 数据生成去重股票代码。
3. 批量生成日线或年线 kline 文件。
4. 支持本机与 AWS Lambda 两种 kline 获取方式。
5. 支持自动 fallback。
6. 支持跳过已存在 kline 文件。
7. 支持生成 summary。
8. 支持巡检空 kline、坏 JSON、缺少 `data.klines` 的文件。

后续重构应围绕这条链路，而不是继续平均维护所有历史脚本。

## 4. 数据直接提交到仓库，但要有边界

本方案明确采用：

```text
数据直接提交到仓库
提交信息记录采集摘要
run.json 记录机器可读详情
reports 保存人可读结果
```

但不是所有文件都适合进仓库。

### 4.1 适合提交的数据

```text
data/pool/<date>/dt.json
data/pool/<date>/qs.json
data/pool/<date>/zb.json
data/pool/<date>/zt.json
data/pool/<date>/codes.json

data/kline/daily/<prefix>/<code>.json
data/kline/yearly/<prefix>/<code>.json

runs/<run_id>/run.json
runs/<run_id>/failures.json
runs/<run_id>/quality.json

reports/<date>/candidates.csv
reports/<date>/candidates.json
reports/<date>/quality.json
reports/<date>/summary.md
```

### 4.2 不适合提交的数据

```text
大型 SQLite / DuckDB 数据库
node_modules
临时日志
curl 原始调试输出
巨大压缩包
重复备份文件
浏览器缓存
单个超大 JSON 文件
```

数据库可以作为本地或 CI 临时构建产物。长期主数据源应是 Git 中可 diff、可追溯、可分片的数据文件和 manifest。

## 5. 推荐目录结构

```text
.
├── bin/
│   └── x
├── config/
│   ├── default.json
│   └── local.example.json
├── data/
│   ├── pool/
│   │   └── 20260325/
│   │       ├── dt.json
│   │       ├── qs.json
│   │       ├── zb.json
│   │       ├── zt.json
│   │       └── codes.json
│   └── kline/
│       ├── daily/
│       │   ├── 000/
│       │   │   ├── 000007.json
│       │   │   └── 000008.json
│       │   ├── 002/
│       │   ├── 300/
│       │   └── 600/
│       └── yearly/
│           ├── 000/
│           ├── 002/
│           ├── 300/
│           └── 600/
├── runs/
│   └── 20260325T163000_daily/
│       ├── run.json
│       ├── failures.json
│       └── quality.json
├── reports/
│   └── 20260325/
│       ├── candidates.csv
│       ├── candidates.json
│       ├── quality.json
│       └── summary.md
├── src/
│   ├── core/
│   ├── sources/
│   ├── runners/
│   ├── pipelines/
│   ├── quality/
│   ├── signals/
│   └── reports/
├── legacy/
│   └── bash/
├── tests/
│   └── fixtures/
└── docs/
```

重点：`data/kline` 要按代码前缀分片，避免几千个 JSON 文件堆在单个目录中。

## 6. 数据文件格式原则

为了让 Git diff 有维护价值，数据文件必须 deterministic。

### 6.1 必须稳定

```text
字段顺序固定
缩进固定
数组排序固定
日期升序
同一次输入重复运行不应产生无意义 diff
```

### 6.2 数据和运行元信息分离

Kline 数据文件只保存可研究的数据：

```json
{
  "code": "000007",
  "market": 0,
  "period": "daily",
  "klines": [
    "1992-04-13,1.87,2.02,2.16,1.87,319,3781000,56.86,296.08,1.51,0.38"
  ]
}
```

运行信息放到 `runs/<run_id>/run.json`：

```json
{
  "run_id": "20260325T163000_daily",
  "engine": "aws",
  "source_region": "ap-northeast-1",
  "fetched": 7543,
  "quality": "ok"
}
```

不要把 `source_region`、`fetched_at`、临时 retry 信息写进每只股票的数据文件，否则每次运行都会制造无意义 diff。

## 7. 统一 CLI 设计

应新增 `bin/x` 作为唯一推荐入口。初期可以只是薄封装，内部继续调用现有 Node 脚本。

```bash
# 环境检查
x doctor

# Pool 数据
x pool pull --date 20260325
x pool pull --latest
x pool pull --range-days 21
x pool validate --date 20260325

# 股票代码池
x codes build data/pool/20260325
x codes merge data/pool/20260325 data/pool/20260324

# Kline
x kline fetch 000035 --period daily
x kline sync data/pool/20260325 --period daily --limit 10
x kline sync data/pool/20260325 --period yearly
x kline validate --period daily
x kline retry --run-id <run_id>

# 信号和报告
x signal year-breakout --date 20260325
x signal limit-up --date 20260325
x report daily --date 20260325

# 数据提交
x git status-data --date 20260325
x git commit-data --date 20260325
x daily --latest --commit

# 任务运行
x run list
x run show <run_id>
x run failures <run_id>
x run retry <run_id>
```

## 8. GitHub Actions 结合方式

GitHub Actions 应成为自动化执行器。

推荐两个 workflow：

```text
.github/workflows/ci.yml
.github/workflows/daily-data-commit.yml
```

### 8.1 CI workflow

用于代码质量和 fixture 测试，不提交数据。

```text
push / pull_request
  -> JS syntax check
  -> Python compile check
  -> Shell syntax check
  -> fixture smoke test
```

### 8.2 Daily data commit workflow

用于每日数据采集、校验和提交。

```text
schedule / workflow_dispatch
  -> pull pool
  -> build codes
  -> sync kline
  -> validate kline
  -> generate reports
  -> write run manifest
  -> git commit
  -> git push
```

自动提交的 commit message 必须包含：

```text
run_id
pool_date
period
engine
total
success
failed
skipped
quality
```

## 9. 提交信息是维护入口

数据提交信息应同时给人和机器阅读。

格式：

```text
<type>(<scope>): <date> <summary>

run_id: <run_id>
pool_date: <YYYYMMDD>
period: <daily|yearly>
engine: <local|aws|auto>
total: <N>
success: <N>
failed: <N>
skipped: <N>
quality: <ok|failed|recorded>
```

示例：

```text
data(kline): 20260325 daily update 300/312 ok

run_id: 20260325T163000_daily
pool_date: 20260325
period: daily
engine: auto
total: 312
success: 300
failed: 12
skipped: 0
quality: failed
```

报告提交：

```text
report(daily): 20260325 add 18 candidates

run_id: 20260325T170000_report
pool_date: 20260325
signals: limit_up_pool,year_breakout,volume_expand
candidates: 18
quality: ok
```

这样可以直接用 Git 查询：

```bash
git log --oneline -- data/pool
git log --oneline -- data/kline/daily/000/000007.json
git log --grep "20260325"
git log --grep "failed"
```

## 10. 推荐拆分提交粒度

稳定后建议把每日任务拆成多条提交：

```text
data(pool): 20260325 add dt qs zb zt snapshots
data(codes): 20260325 build 312 pool codes
data(kline): 20260325 daily update 300/312 ok
quality(kline): 20260325 record daily quality report
report(daily): 20260325 add 18 candidates
```

初期也可以先合并成一条：

```text
data(daily): 20260325 update pool, codes and daily kline
```

但无论单条还是多条，都必须有 `run.json`。

## 11. Run Manifest 设计

每个批量任务必须生成：

```text
runs/<run_id>/run.json
runs/<run_id>/failures.json
runs/<run_id>/quality.json
```

示例：

```json
{
  "run_id": "20260325T094000Z_kline_daily",
  "type": "kline_sync",
  "date": "20260325",
  "period": "daily",
  "engine": "auto",
  "input": "data/pool/20260325/codes.json",
  "status": "completed_with_failures",
  "total": 312,
  "success": 300,
  "skipped": 8,
  "failed": 4,
  "started_at": "2026-03-25T09:40:00Z",
  "finished_at": "2026-03-25T09:47:00Z",
  "artifacts": {
    "summary": "data/kline/daily/summary.daily.json",
    "failures": "runs/20260325T094000Z_kline_daily/failures.json",
    "quality": "runs/20260325T094000Z_kline_daily/quality.json"
  }
}
```

有了 manifest 后，可以实现：

```bash
x run list
x run show 20260325T094000Z_kline_daily
x run failures 20260325T094000Z_kline_daily
x run retry 20260325T094000Z_kline_daily
```

## 12. Kline Runner 抽象

现有 `fetch_kline.js` 已经支持 `local`、`aws`、`auto`。应提升为标准 runner 接口。

```js
class KlineRunner {
  async fetch({ secid, period, limit, endDate }) {
    throw new Error("not implemented");
  }
}
```

实现：

```text
LocalKlineRunner       使用本机 HTTP / 代理
AwsLambdaKlineRunner   使用 AWS Lambda 多 region
AutoKlineRunner        先 AWS，失败后 local fallback
ReplayFixtureRunner    测试用，从 fixture 回放
CachedRunner           如果仓库已有且质量通过则直接返回
```

Pipeline 不应关心数据来自 AWS 还是本机：

```js
const data = await runner.fetch({ secid, period });
await dataWriter.writeDeterministic(data);
await validator.validateKline(data);
await manifest.record(data);
```

## 13. Eastmoney Client 抽象

当前 `fetch_pool.js` 依赖 `curl_*.txt` 模板，通过 patch 日期、callback 和 `_` 参数来生成请求。这种方式适合验证，但不适合作为长期核心。

建议抽象为：

```text
src/sources/eastmoney/poolClient.js
src/sources/eastmoney/klineClient.js
src/sources/eastmoney/jsonp.js
src/sources/eastmoney/headers.js
```

接口示例：

```js
const pool = await poolClient.fetchPool({
  type: "dt",
  date: "20260325",
  pageSize: 1700
});

const kline = await klineClient.fetchKline({
  secid: "0.000035",
  period: "daily",
  limit: 10000,
  endDate: "20991231"
});
```

统一处理：

```text
URL 构造
Header
JSONP 解析
HTTP timeout
retry
schema normalize
error message
```

旧 `curl_*.txt` 可保留为 fixture 或 fallback，但不应继续作为长期唯一请求定义。

## 14. 数据质量门禁

数据进入仓库前必须通过基础校验，至少要生成质量报告。

### 14.1 Kline 校验

```text
文件非空
JSON 可解析
data 存在
data.klines 存在
data.klines 是数组
klines 非空
每行字段数量正确
日期格式正确
日期升序
日期不重复
open/high/low/close 可解析为数字
high >= open/close/low
low <= open/close/high
volume >= 0
turnover >= 0
```

### 14.2 Pool 校验

```text
rc 是否正常
data.pool 是否存在
qdate 是否等于目标日期
pool item 是否包含 code/name/market/price
dt/qs/zb/zt 是否齐全
单个 pool 为空是否符合预期
多日拉取时 empty_boundary 是否合理
```

### 14.3 提交门禁

```text
每个数据提交必须有 run.json
每个数据提交必须有 quality.json
如果有 failed，commit message 必须写 failed 数量
失败项必须写入 failures.json
```

## 15. 信号与报告层

`process/` 应升级成两个模块：

```text
src/signals/
src/reports/
```

先实现：

```text
limit_up_pool          是否进入涨停池 / 强势池 / 炸板池 / 跌停池
year_breakout          年线突破 / 历史高点突破
volume_expand          成交额放大
trend_strength         均线趋势强度
pool_persistence       多日连续进入强势池
```

日报输出：

```text
reports/20260325/
  candidates.csv
  candidates.json
  quality.json
  summary.md
```

候选股记录：

```json
{
  "date": "20260325",
  "code": "000035",
  "name": "...",
  "signals": ["limit_up_pool", "year_breakout", "volume_expand"],
  "score": 82,
  "reason": "进入涨停池，突破年线高点，近20日成交额放大",
  "data_quality": "ok"
}
```

## 16. `.gitignore` 调整原则

如果数据要进仓库，就不能忽略 `data/`、`runs/`、`reports/`。

建议忽略：

```gitignore
# runtime temp
/tmp_*.json
*.log
*.tmp

# local env
.env
config/local.json

# local generated databases
*.db
*.sqlite
*.db-wal
*.db-shm
*.duckdb
*.duckdb.wal

# dependencies
node_modules/

# OS/editor
.DS_Store
.vscode/
.idea/
```

保留：

```text
data/**
runs/**
reports/**
```

## 17. 分阶段执行计划

### Phase 0：确立数据账本规范

目标：让数据进仓库有规则。

任务：

- 新增 `docs/DATA_COMMIT_POLICY.md`。
- 明确数据目录结构。
- 明确 commit message 格式。
- 明确 run manifest 格式。
- 明确哪些数据可以提交，哪些不能提交。
- 调整 `.gitignore`，保留 `data/`、`runs/`、`reports/`。

验收：

- 数据提交有文档可依。
- GitHub Actions 和人工提交使用同一套规范。

### Phase 1：统一 CLI

目标：一个入口完成采集、校验、提交。

任务：

- 新增 `bin/x`。
- 封装现有 Node 脚本。
- 增加 `x doctor`。
- 增加 `x git commit-data`。
- README 改成只推荐 `x ...` 命令。

验收：

```bash
x daily --latest --limit 10 --commit
```

可以跑通并生成规范提交。

### Phase 2：GitHub Actions 自动提交数据

目标：每日自动采集、校验、提交。

任务：

- 新增 `ci.yml`。
- 新增 `daily-data-commit.yml`。
- workflow 支持 `schedule` 和 `workflow_dispatch`。
- 自动生成 commit message。
- 自动跳过无变化提交。

验收：

- 手动触发 workflow 可以生成数据提交。
- 定时任务可以在交易日自动提交。

### Phase 3：deterministic writer 和分片迁移

目标：减少无意义 diff，提高可维护性。

任务：

- Kline 写入改成固定结构。
- 移除数据文件中的运行动态字段。
- 运行动态字段写入 run manifest。
- `data/kline` 按代码前缀分片。

验收：

- 同样输入重复运行不会产生 diff。
- 单个目录文件数可控。

### Phase 4：模块化 Node 主线

目标：让现有 Node 脚本变成可测试模块。

任务：

- 抽出 `src/core/date.js`。
- 抽出 `src/core/secid.js`。
- 抽出 `src/core/retry.js`。
- 抽出 `src/sources/eastmoney/jsonp.js`。
- 抽出 `src/sources/eastmoney/poolClient.js`。
- 抽出 `src/sources/eastmoney/klineClient.js`。

验收：

- 现有脚本行为不变。
- 核心模块有单元测试。

### Phase 5：信号和报告产品化

目标：让仓库每天不仅保存数据，还保存研究结果。

任务：

- 把 `process/` 中有效脚本迁入 `src/signals/`。
- 实现候选股评分。
- 实现日报生成。
- 输出 JSON、CSV、Markdown。

验收：

```bash
x report daily --date 20260325
```

生成并提交：

```text
reports/20260325/candidates.csv
reports/20260325/candidates.json
reports/20260325/summary.md
```

## 18. 推荐前 5 个提交

```text
docs: add data commit policy
build: add unified x cli wrapper
ci: add daily data commit workflow
refactor: write deterministic kline data files
quality: add run manifest and kline validation gate
```

## 19. 仓库维护红线

```text
1. 单个数据文件不能过大。
2. 单次提交不要改动不可控数量的文件。
3. 不提交大型数据库文件。
4. 不提交压缩包作为常规数据格式。
5. 每个数据提交必须有 run.json。
6. 每个数据提交必须有清晰 commit message。
7. 数据文件必须 deterministic。
8. GitHub Actions 自动提交前必须生成 quality.json。
9. 失败项必须能从 failures.json 找到。
10. 报告和数据应分开提交或至少在 commit message 中分开说明。
```

## 20. 最终形态

理想状态下，Git log 长这样：

```text
report(daily): 20260325 add 18 candidates
quality(kline): 20260325 daily quality ok
data(kline): 20260325 daily update 300/312 ok
data(codes): 20260325 build 312 pool codes
data(pool): 20260325 add dt qs zb zt snapshots
```

仓库中长期保存：

```text
可信数据文件
可追溯任务记录
可重试失败项
可解释策略信号
每日候选股票报告
```

这才是 `x` 作为数据账本型研究仓库的长期价值。
