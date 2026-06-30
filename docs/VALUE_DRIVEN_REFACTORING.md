# x 仓库价值导向重构方案

> 日期：2026-06-30  
> 目标：把 `x` 从脚本工作区重构为稳定、可恢复、可验证、可追溯的 A 股数据与信号研究系统。

## 1. 重新定位

当前项目已经不只是一个 Bash 脚本集合，而是在长成一个以 A 股数据采集、股票池构建、Kline 补齐、数据质量检查和策略信号输出为核心的研究工作区。

本次重构不应再以“把脚本写整洁”为第一目标，而应以“每天稳定产出有价值的研究结果”为第一目标。

项目的价值闭环应定义为：

```text
Pool 数据
  -> 股票代码池 codes
  -> 日线 / 年线 Kline
  -> 数据质量校验
  -> 信号计算 / 策略研究
  -> 每日候选股与研究报告
```

最终目标不是“我能抓到很多 JSON”，而是：

```text
每天能稳定生成可信的数据资产、策略信号、候选股票池和可复盘报告。
```

## 2. 当前新增内容带来的关键变化

从当前 `master` 看，项目已经出现了一条新的 Node.js 主线：

```text
fetch/pull_pool_task.js
utils/parse_pool_json.js
fetch/query_pool_klines.js
fetch/fetch_kline.js
fetch/check_kline_empty.js
```

这条主线已经具备下面几个能力：

1. 拉取指定日期或最近交易日的 pool 数据。
2. 从 pool 数据生成去重股票代码。
3. 批量生成日线或年线 kline 文件。
4. 支持本机与 AWS Lambda 两种 kline 获取方式。
5. 支持自动 fallback。
6. 支持跳过已存在 kline 文件。
7. 支持生成 summary。
8. 支持巡检空 kline、坏 JSON、缺少 `data.klines` 的文件。

这说明新的核心价值链路已经形成。后续重构应围绕这条链路展开，而不是继续平均用力维护所有历史脚本。

## 3. 当前最大结构性问题

### 3.1 数据资产和代码仓库混在一起

`data/`、`eastmoney_data/`、`data/pool/<YYYYMMDD>/`、`data/kline/daily/`、`data/kline/yearly/` 本质上都是运行产物。它们不应和普通代码改动混在同一个提交里。

如果继续把大量 kline JSON 提交到 Git，会带来几个问题：

- 仓库迅速膨胀。
- 代码 diff 被数据刷新淹没。
- 很难判断一次提交到底是在改逻辑还是刷新数据。
- 数据质量问题会变成 Git 历史负担。
- 后续 CI、review、回滚都会变慢。

### 3.2 新 Node 主线和旧 Bash 主线并存

当前 README 前半部分已经在介绍 Node 工作流，但后半部分仍保留大量 `/root/x/...` 形式的旧 Bash 使用方式。这说明项目处在迁移中间态。

如果继续平行维护两套入口，会产生：

- 使用者不知道该走哪条主线。
- 配置散落在 Bash、Node、JSON 文件和环境变量中。
- 代理、限流、重试、JSONP 清洗等能力重复实现。
- 新功能越来越难组合成完整流水线。

### 3.3 采集能力已经变强，但任务系统还没建立

`query_pool_klines.js` 已经有 summary、failed、skipped_existing 等概念，但它们还只是文件级输出，不是统一的任务运行系统。

缺少：

- run id
- run manifest
- 失败清单标准格式
- 可重试任务
- 可查询任务历史
- 输入、输出、参数、代码版本之间的关系

### 3.4 数据校验仍停留在“空不空”

`check_kline_empty.js` 是很好的开始，但策略研究需要更强的数据质量门禁。

仅判断文件是否为空还不够，还需要检查：

- 日期是否升序。
- 日期是否重复。
- OHLC 是否合理。
- 成交量和成交额是否非负。
- 最新交易日是否明显滞后。
- pool 的 `qdate` 是否和目标日期一致。
- pool 的四类数据是否齐全。
- 采集成功率和空文件率是否达标。

### 3.5 真正价值层还没有产品化

项目已经有突破、涨停、统计、回测相关脚本，但它们还没有被统一成信号层和报告层。

从价值导向看，采集数据只是中间过程。最终应该每天回答：

```text
今天有哪些股票值得研究？
为什么值得研究？
使用了哪些数据？
数据质量是否可信？
历史表现如何？
```

## 4. 重构总原则

### 4.1 以价值流为边界，而不是以脚本语言为边界

不要按 Bash、Node、Python 分别重构，而要按业务价值流重构：

```text
pool -> codes -> kline -> validate -> signal -> report
```

每一层都应有清晰输入、输出和验收标准。

### 4.2 新功能走 Node 主线，旧 Bash 进入 legacy

推荐策略：

- Node.js 作为新的采集与流水线主线。
- Bash 保留为兼容入口和历史工具。
- Python 可以保留在统计、回测、数据库分析中，但需要有明确边界。
- 旧脚本不必马上删除，但不应继续作为新功能承载层。

### 4.3 原始数据、标准数据、信号结果分层存储

建议分为：

```text
raw artifacts      原始 API 返回，尽量不改
canonical data     结构化标准数据，用于查询和计算
signals/reports    研究结果和候选输出
```

不要长期依赖“每只股票一个 JSON 文件”作为唯一数据形态。

### 4.4 任何批量任务必须可恢复、可追踪、可重跑

所有批量采集和计算任务都应产生 manifest：

- 输入是什么
- 参数是什么
- 运行时间是什么
- 成功多少
- 失败多少
- 失败原因是什么
- 产物在哪里
- 是否可以只重试失败项

### 4.5 质量检查是流水线的一部分，不是事后工具

每次采集完成后，都应该自动执行质量检查。只有通过质量门禁的数据才能进入数据库、信号计算和报告输出。

## 5. 目标架构

推荐把项目重构成三层架构。

### 5.1 数据采集层

负责把外部数据可靠拿回来。

```text
EastmoneyPoolClient
EastmoneyKlineClient
LocalKlineRunner
AwsLambdaKlineRunner
AutoKlineRunner
ProxyRunner
ReplayFixtureRunner
```

核心职责：

- 构造请求。
- 处理 JSONP。
- 管理 Header。
- 超时与重试。
- AWS Lambda 调用。
- 本机 fallback。
- 返回统一数据结构。

### 5.2 数据资产层

负责把数据变成可查询、可验证、可复盘的资产。

```text
RawStore
KlineStore
PoolStore
ManifestStore
RunStore
QualityValidator
```

核心职责：

- 保存原始 JSON。
- 写入 SQLite / DuckDB / Parquet。
- 记录 run manifest。
- 记录失败项。
- 管理数据版本。
- 校验数据质量。

### 5.3 信号价值层

负责把数据转化成研究结果。

```text
LimitUpSignal
YearBreakoutSignal
PoolStrengthSignal
TrendSignal
DailyCandidateReport
BacktestReport
QualityReport
```

核心职责：

- 计算策略信号。
- 合并多个信号。
- 给候选股打分。
- 输出理由。
- 生成每日报告。
- 支持回测和复盘。

## 6. 推荐目录结构

```text
.
├── bin/
│   └── x
├── config/
│   ├── default.json
│   ├── local.example.json
│   └── eastmoney/
│       └── pool_templates/
├── src/
│   ├── cli/
│   ├── core/
│   │   ├── config.js
│   │   ├── logger.js
│   │   ├── date.js
│   │   ├── secid.js
│   │   └── retry.js
│   ├── sources/
│   │   └── eastmoney/
│   │       ├── poolClient.js
│   │       ├── klineClient.js
│   │       ├── jsonp.js
│   │       └── headers.js
│   ├── runners/
│   │   ├── localKlineRunner.js
│   │   ├── awsLambdaKlineRunner.js
│   │   └── autoKlineRunner.js
│   ├── pipelines/
│   │   ├── pullPool.js
│   │   ├── buildCodes.js
│   │   ├── syncKlines.js
│   │   └── dailyWorkflow.js
│   ├── storage/
│   │   ├── localFileStore.js
│   │   ├── s3Store.js
│   │   ├── sqliteStore.js
│   │   └── manifestStore.js
│   ├── quality/
│   │   ├── validatePool.js
│   │   ├── validateKline.js
│   │   └── qualityReport.js
│   ├── signals/
│   │   ├── limitUp.js
│   │   ├── yearBreakout.js
│   │   ├── poolStrength.js
│   │   └── trend.js
│   └── reports/
│       └── dailyCandidates.js
├── legacy/
│   └── bash/
├── tests/
│   └── fixtures/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATA_CONTRACT.md
│   ├── OPERATIONS.md
│   └── VALUE_DRIVEN_REFACTORING.md
├── data/
│   └── README.md
├── runs/
│   └── README.md
└── reports/
    └── README.md
```

## 7. 统一 CLI 设计

应新增 `bin/x` 作为唯一推荐入口。初期可以只是薄封装，内部继续调用现有脚本。这样可以先统一用户体验，再逐步替换内部实现。

目标命令：

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

# 数据库 / 数据资产
x db init
x db import-pool --date 20260325
x db import-kline --period daily
x db vacuum

# 信号
x signal year-breakout --date 20260325
x signal limit-up --date 20260325
x signal pool-strength --date 20260325

# 报告
x report daily --date 20260325
x report quality --run-id <run_id>

# 任务运行
x run list
x run show <run_id>
x run failures <run_id>
x run retry <run_id>
```

## 8. 数据管理方案

### 8.1 Git 只管理代码和少量 fixture

应立即把生成数据从 Git 主线中剥离。

建议 `.gitignore`：

```gitignore
/data/
/eastmoney_data/
/pool_data/
/runs/
/reports/
*.log
*.sqlite
*.db
*.db-wal
*.db-shm
.env
config/local.json
```

保留少量测试样本：

```text
tests/fixtures/pool/20260325/dt.json
tests/fixtures/pool/20260325/qs.json
tests/fixtures/kline/daily/000007.json
tests/fixtures/kline/empty.json
```

### 8.2 原始数据进入对象存储或 DVC

完整数据建议不要直接进 Git。

可选方案：

1. **S3 / R2 / OSS + manifest**：最推荐，尤其项目已经使用 AWS Lambda。
2. **DVC**：适合追踪数据版本，但不希望 Git 存大文件。
3. **Git LFS**：临时可用，但长期不如对象存储清晰。

### 8.3 分析层使用 SQLite / DuckDB / Parquet

JSON 文件适合做 raw artifact，不适合长期作为唯一分析数据源。

建议 canonical schema：

```sql
CREATE TABLE securities (
    code TEXT PRIMARY KEY,
    market INTEGER NOT NULL,
    secid TEXT UNIQUE NOT NULL,
    name TEXT,
    updated_at TEXT
);

CREATE TABLE pool_snapshots (
    trade_date TEXT NOT NULL,
    pool_type TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT,
    market INTEGER,
    price REAL,
    event_time TEXT,
    raw_json TEXT,
    PRIMARY KEY (trade_date, pool_type, code)
);

CREATE TABLE klines (
    secid TEXT NOT NULL,
    period TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    open REAL,
    close REAL,
    high REAL,
    low REAL,
    volume INTEGER,
    amount REAL,
    change_pct REAL,
    raw_line TEXT,
    PRIMARY KEY (secid, period, trade_date)
);

CREATE TABLE signals (
    trade_date TEXT NOT NULL,
    signal_name TEXT NOT NULL,
    code TEXT NOT NULL,
    score REAL,
    reason TEXT,
    features_json TEXT,
    PRIMARY KEY (trade_date, signal_name, code)
);

CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    params_json TEXT,
    status TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    summary_json TEXT
);

CREATE TABLE failures (
    run_id TEXT NOT NULL,
    target TEXT NOT NULL,
    reason TEXT,
    retry_count INTEGER DEFAULT 0,
    PRIMARY KEY (run_id, target)
);
```

## 9. Run Manifest 设计

每个批量任务都应生成 run manifest。

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
    "summary": "runs/20260325T094000Z_kline_daily/summary.json",
    "failures": "runs/20260325T094000Z_kline_daily/failures.json"
  }
}
```

推荐目录：

```text
runs/
  20260325T093000Z_pool_pull/
    run.json
    logs.txt
    failures.json
  20260325T094000Z_kline_daily/
    run.json
    logs.txt
    failures.json
```

有了 manifest 后，可以实现：

```bash
x run list
x run show 20260325T094000Z_kline_daily
x run failures 20260325T094000Z_kline_daily
x run retry 20260325T094000Z_kline_daily
```

## 10. Kline Runner 抽象

现有 `fetch_kline.js` 已经支持 `local`、`aws`、`auto`，这是很好的方向。建议把它提升为标准 runner 接口。

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
CachedRunner           如果本地已有且质量通过则直接返回
```

Pipeline 不应关心数据来自 AWS 还是本机：

```js
const data = await runner.fetch({ secid, period });
await rawStore.write(data);
await validator.validateKline(data);
await klineStore.upsert(data);
```

这样可以显著降低复杂度，也方便测试。

## 11. Eastmoney Client 抽象

当前 `fetch_pool.js` 依赖 `curl_*.txt` 模板，通过 patch 日期、callback 和 `_` 参数来生成请求。这种方式适合快速验证，但不适合作为长期核心。

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
  limit: 100000,
  endDate: "20991231"
});
```

统一处理：

- URL 构造
- Header
- JSONP 解析
- HTTP timeout
- retry
- schema normalize
- error message

旧 `curl_*.txt` 可保留为 fixture 或 fallback，但不应继续作为长期唯一请求定义。

## 12. 数据质量门禁

### 12.1 Kline 校验

应从“空文件检测”升级为完整校验：

```text
文件级：
- 文件非空
- JSON 可解析
- data 存在
- data.klines 存在
- data.klines 是数组
- klines 非空

记录级：
- 每行字段数量正确
- 日期格式正确
- 日期升序
- 日期不重复
- open/high/low/close 可解析为数字
- high >= open/close/low
- low <= open/close/high
- volume >= 0
- turnover >= 0

任务级：
- 成功率 >= 阈值
- 空文件率 <= 阈值
- latest date 不明显滞后
- AWS region 成功率可观测
```

### 12.2 Pool 校验

```text
- rc 是否正常
- data.pool 是否存在
- qdate 是否等于目标日期
- pool item 是否包含 code/name/market/price
- dt/qs/zb/zt 是否齐全
- 单个 pool 为空是否符合预期
- 多日拉取时 empty_boundary 是否合理
```

### 12.3 数据库校验

```text
- pool_snapshots 去重
- klines 主键去重
- securities 引用完整
- 导入前后数量匹配
- 失败项可追踪
```

质量检查命令：

```bash
x data validate --date 20260325
x pool validate --date 20260325
x kline validate --period daily
x db validate
```

## 13. 信号与报告层

`process/` 应升级成两个清晰模块：

```text
src/signals/
src/reports/
```

### 13.1 信号层

建议先实现：

```text
limit_up_pool          是否进入涨停池 / 强势池 / 炸板池 / 跌停池
year_breakout          年线突破 / 历史高点突破
volume_expand          成交额放大
trend_strength         均线趋势强度
pool_persistence       多日连续进入强势池
```

信号输出：

```json
{
  "date": "20260325",
  "code": "000035",
  "signal": "year_breakout",
  "score": 78,
  "features": {
    "close": 12.34,
    "year_high": 12.1,
    "above_high_pct": 1.98
  },
  "reason": "收盘价突破年内高点，且进入强势池"
}
```

### 13.2 报告层

日报输出：

```text
reports/20260325/
  candidates.csv
  candidates.json
  quality.json
  run_summary.json
```

候选股记录建议包含：

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

## 14. 测试与 CI

当前项目缺少正式测试框架和覆盖率门禁。随着 Node 主线、AWS runner、数据质量和信号层增长，必须补上基础测试。

### 14.1 Node 测试

可先使用 Node 内置测试框架：

```bash
node --test
```

测试重点：

```text
secid 推断
JSONP 解析
pool normalize
kline normalize
empty kline 检测
summary 生成
skipped_existing 行为
失败项记录
run manifest 生成
```

### 14.2 Shell 检查

旧 Bash 仍在时，应至少跑：

```bash
shellcheck legacy/bash/**/*.sh
```

### 14.3 CI 最小版本

```yaml
name: ci
on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node --test
      - run: python -m compileall .
```

## 15. 分阶段执行计划

### Phase 0：止血，分离代码和数据

目标：避免仓库继续被生成数据污染。

任务：

- 扩展 `.gitignore`。
- 从 Git index 移除 `data/`、`eastmoney_data/` 等生成目录。
- 保留少量 fixture 到 `tests/fixtures/`。
- 增加 `data/README.md` 说明数据不入 Git。
- 增加 `runs/README.md` 和 `reports/README.md`。

验收：

- 普通采集不会导致大量 JSON 出现在 `git status`。
- fixture 足够支持离线测试。

### Phase 1：统一 CLI

目标：让用户只记一个入口。

任务：

- 新增 `bin/x`。
- 封装现有 Node 脚本。
- 增加 `x doctor`。
- README 改成只推荐 `x ...` 命令。
- 旧命令放入 legacy usage。

验收：

```bash
x pool pull --latest
x codes build data/pool/<date>
x kline sync data/pool/<date> --period daily --limit 10
x kline validate --period daily
```

可以完整跑通。

### Phase 2：模块化 Node 采集链路

目标：把 CLI 脚本里的公共逻辑抽到 `src/`。

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

### Phase 3：Runner 化 AWS / Local / Auto

目标：明确采集执行环境。

任务：

- 建立 `KlineRunner` 接口。
- 实现 `LocalKlineRunner`。
- 实现 `AwsLambdaKlineRunner`。
- 实现 `AutoKlineRunner`。
- 实现 `ReplayFixtureRunner` 用于测试。

验收：

- `x kline fetch 000035 --engine auto` 走统一 runner。
- 测试可以不访问真实网络。

### Phase 4：建立 run manifest 和失败重试

目标：批量任务可追踪、可恢复。

任务：

- 每个批量任务生成 run id。
- 统一写 `runs/<run_id>/run.json`。
- 统一写 `failures.json`。
- 支持 `x run failures`。
- 支持 `x run retry`。

验收：

- 任意批量任务失败后，不需要人工整理失败项即可重试。

### Phase 5：建设 canonical data store

目标：让分析层不再依赖大量 JSON 文件扫描。

任务：

- 建立 SQLite / DuckDB schema。
- 导入 pool_snapshots。
- 导入 klines。
- 导入 runs / failures。
- 增加增量 upsert。

验收：

- 可以通过 SQL 查询任意股票、日期、pool、kline。
- 信号计算直接读标准表。

### Phase 6：信号和报告产品化

目标：每天稳定产出候选结果。

任务：

- 把 `process/` 中有效脚本迁入 `src/signals/`。
- 实现候选股评分。
- 实现日报生成。
- 输出 JSON 和 CSV。
- 记录数据质量摘要。

验收：

```bash
x report daily --date 20260325
```

生成：

```text
reports/20260325/candidates.csv
reports/20260325/candidates.json
reports/20260325/quality.json
```

## 16. 优先级排序

### 最高优先级 P0

1. 数据和代码分离。
2. 增加统一 CLI。
3. 把 Node 新主线确认为主线。
4. 扩展 `.gitignore`。
5. 增加 fixture。

### 高优先级 P1

1. 抽出 Eastmoney client。
2. 抽出 Kline runner。
3. 建立 run manifest。
4. 建立数据质量门禁。
5. 补 Node 单元测试。

### 中优先级 P2

1. Bash 迁入 legacy。
2. SQLite / DuckDB canonical store。
3. signals 和 reports 产品化。
4. CI。
5. 数据湖 / 对象存储。

## 17. 不建议做的事情

短期不建议：

- 一次性重写所有 Bash。
- 继续把大量 kline JSON 提交进 Git。
- 继续新增零散脚本而不接入统一 CLI。
- 先做复杂策略而不做数据质量门禁。
- 让 AWS、本机、代理三套采集逻辑继续各自发展。
- 把 README 继续扩成所有历史命令的大杂烩。

## 18. 推荐的前 5 个提交

```text
chore: ignore generated data and runtime outputs
build: add unified x cli wrapper
test: add pool and kline fixtures
refactor: extract eastmoney jsonp and secid utilities
feat: add run manifest for kline sync
```

这 5 个提交完成后，项目会从“脚本堆叠”进入“流水线雏形”阶段。

## 19. 最终形态

理想状态下，日常工作只需要：

```bash
x doctor
x pool pull --latest
x codes build data/pool/<date>
x kline sync data/pool/<date> --period daily
x kline validate --period daily
x db import-kline --period daily
x report daily --date <date>
```

最终产出不是一堆中间 JSON，而是：

```text
可信数据资产
可追溯任务记录
可重试失败项
可解释策略信号
每日候选股票报告
```

这才是 `x` 项目最值得重构出来的长期价值。