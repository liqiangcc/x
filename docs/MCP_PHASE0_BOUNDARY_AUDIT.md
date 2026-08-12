# MCP Phase 0：现有代码边界盘点与重构清单

> 日期：2026-08-12  
> 状态：Phase 0 完成  
> 目标：在开始 MCP 编码前，识别 `x` 现有代码中的 Business / Capability / Logic / Control / Infrastructure 边界，明确哪些能力可直接复用、哪些模块需要抽边界、哪些模块不应被 MCP 直接依赖。

## 1. 结论摘要

当前仓库**不需要为了 MCP 进行大规模重写**。

现有代码已经存在两类不同成熟度的模块：

1. `src/simulator/` 已经形成较清晰的 `core / mechanisms / application / ports / adapters` 分层，可以作为 MCP 化的架构参考。
2. `src/kline/`、`src/stats/`、部分 `src/signals/` 仍存在“纯逻辑 + 文件/数据库 IO + 流程控制”混在同一模块的问题，需要先抽边界，再供 MCP 复用。

MCP 第一阶段应采用：

```text
保留现有纯能力
  +
抽取共享 Port
  +
增加窄 Application Use Case
  +
最后增加 MCP Adapter
```

而不是：

```text
MCP Tool
  -> 直接读取 data/
  -> 复制指标/策略算法
  -> 直接调用巨型 Runtime Service
```

Phase 0 的核心判断：

> MCP 不是重构终点，而是迫使共享业务边界变清晰的一个新 Adapter。

---

## 2. 分类标准

本次盘点使用五类边界。

### 2.1 Business

回答：**为什么做、按什么业务规则组合能力。**

示例：

- 每跌 N% 加仓；
- 连续下跌三年后首次突破；
- 买入资格；
- 策略候选排序；
- 模拟交易规则组合。

### 2.2 Capability

回答：**系统能做什么。**

要求：通用、稳定、可组合，不携带具体投资场景。

示例：

- 读取 K 线；
- 读取证券集合；
- 计算 BOLL；
- 计算回撤；
- 计算收益率；
- 评估策略规则；
- 模拟成交。

### 2.3 Logic

回答：**结果怎么算出来。**

尽量保持：

```text
Input -> deterministic calculation -> Output
```

不得包含文件、SQL、HTTP、MCP、Git、AWS、重试或 workflow 控制。

### 2.4 Control

回答：**什么时候执行、按什么顺序调用、失败怎么办。**

包括：

- Application orchestration；
- Controller；
- CLI Handler；
- HTTP Handler；
- MCP Tool Handler；
- Workflow orchestration；
- retry / timeout / fallback。

### 2.5 Infrastructure

回答：**能力如何接到真实外部资源。**

包括：

- 文件系统；
- SQLite；
- Eastmoney；
- AWS / Huawei Cloud；
- GitHub；
- 本地账本。

---

## 3. 总体边界图

目标架构不是机械层层调用，而是保证依赖方向清晰：

```text
                    MCP / HTTP / CLI / Actions
                              |
                              v
                         Control Layer
                              |
                              v
                     Application / Business
                              |
                +-------------+-------------+
                |                           |
                v                           v
          Capabilities                  Domain Logic
                |                           |
                +-------------+-------------+
                              |
                            Ports
                              |
                              v
                     Infrastructure Adapters
                              |
                              v
                  Repo Ledger / SQLite / API
```

硬约束：

```text
Adapter -> Control -> Business -> Capability/Logic -> Port <- Infrastructure
```

禁止：

```text
MCP -> data/*.json
MCP -> SQLite
MCP -> Eastmoney
Logic -> fs
Logic -> HTTP status code
Infrastructure -> strategy decision
Controller -> “跌 8% 买 10%”
```

---

## 4. `src/kline/` 盘点

### 4.1 当前职责概况

现有模块包含：

```text
aggregate_yearly.js
code_universe.js
data_status.js
engine_benchmark.js
engine_selection.js
failure_queue.js
freshness.js
policy.js
sync_lock.js
engines/*
```

该目录目前同时承载：

- K 线确定性计算；
- 数据账本文件访问；
- 同步任务控制；
- 引擎选择；
- 失败队列；
- freshness / data status；
- 并发与锁。

因此 `src/kline/` 是一个“业务域目录”，但不是一个单一架构层。

### 4.2 `aggregate_yearly.js`

当前模块同时包含：

```text
parseKlineRow                 Logic
aggregateYearRows             Logic
extractRows / replaceRows     Ledger mapping
loadFirst / atomicWrite       Infrastructure
aggregateCodeFromDaily        Application + Infrastructure
aggregateYearlyFromDaily      Control / batch orchestration
```

其中 `aggregateYearRows()` 是高价值纯逻辑，应直接保留并作为权威实现。

问题：

- 同一个文件直接 import `node:fs/promises`；
- 纯年度聚合算法与文件路径、原子写入放在同一模块；
- 读取路径直接依赖 Simulator 的 `existing_kline_repository.klinePaths`；
- 单证券聚合和批处理控制在同一模块。

建议目标：

```text
src/kline/logic/yearly_aggregation.js
  parseKlineRow
  aggregateYearRows

src/ports/market/kline_reader.js
src/ports/market/kline_writer.js

src/adapters/ledger/kline_reader.js
src/adapters/ledger/kline_writer.js

src/application/market/aggregate_yearly.js
```

注意：第一阶段 MCP 是只读，因此 `KlineWriter` 不属于 MCP 的前置条件，可以后置。

### 4.3 `data_status.js`

当前模块同时包含：

```text
walkJsonFiles                 Infrastructure
latestDate / latestDateFromFile  Logic + Infrastructure
inspectPeriod                 Application + Infrastructure
latestStrategyUniverse        Infrastructure + projection
buildDataStatus               Application
DataStatusService             Control + cache + pagination
```

问题：

- 文件遍历、尾部读取、状态统计、缓存和分页全部在一个文件；
- `DataStatusService` 的 `getDetails()` 带分页控制语义；
- 对 MCP 来说，直接复用整个 Service 会把文件布局和展示控制带入共享能力。

建议：

```text
LedgerDataInventoryAdapter
  -> 只负责扫描/读取账本元数据

DataStatusClassifier
  -> 纯状态分类

GetDataStatusUseCase
  -> 组装 summary

HTTP/MCP Presenter
  -> 各自处理分页/输出
```

### 4.4 `freshness.js`

当前模块同时包含：

```text
normalizeDate / uniqueCodes / inferExpectedDate  Logic
loadCodesFile / inspectKnownFile                  Infrastructure
inspectFreshness                                  Application + Infrastructure
writeRepairCodes                                  Infrastructure / command side
```

优点：

- `inferExpectedDate()`、`latestKlineDate()` 等已有较明确的确定性逻辑。

问题：

- `inspectFreshness()` 自己扫描目录并读取文件；
- 查询 freshness 与写 repair codes 在同一模块；
- Query 与 Command 没有分离。

建议：

```text
FreshnessClassifier              Logic
KlineInventoryReader             Port
LedgerKlineInventoryReader       Infrastructure
InspectFreshnessUseCase          Application
WriteRepairCodesCommand          单独 Command，不进入 MCP v1
```

### 4.5 `engine_selection.js`

该模块主要属于：

```text
eligibleForCnFast       Policy Logic
probeLocalKline         Infrastructure probe
selectStrategySyncEngine Control / infrastructure policy
```

它服务的是**数据同步控制面**，不是 MCP 查询面。

MCP v1 不应依赖：

```text
engine_selection
engines/*
proxy fallback
AWS Router
Huawei Cloud
```

原因：MCP v1 只读取已有可信账本，不应因为查询触发网络同步。

### 4.6 `kline` Phase 0 决策

| 模块/能力 | 分类 | MCP v1 决策 |
|---|---|---|
| `aggregateYearRows` | Logic | 保留/复用 |
| K 线 row normalize/parse | Logic | 统一为共享权威实现 |
| `ExistingKlineRepository` | Infrastructure | 可复用但需通用 Port 包装 |
| freshness classification | Logic | 抽出后复用 |
| data status inventory | Infrastructure | 通过 Port 使用 |
| engine selection | Control | 不进入 MCP |
| failure queue | Control | 不进入 MCP |
| sync lock | Infrastructure/Control | 不进入 MCP |

---

## 5. `src/stats/` 盘点

### 5.1 当前结构

当前仅有：

```text
src/stats/statistics.js
```

但该文件直接依赖：

```text
../db/sqlite.queryDatabase
```

并把 SQL 与统计用例写在一起。

### 5.2 `yearlyPositivePct`

当前职责：

```text
校验字段
  +
构造 SQL
  +
执行 SQLite
  +
计算年度正收益比例
  +
格式化百分比字符串
```

同时包含：

- Business/analytics semantics；
- Infrastructure SQL；
- Presentation formatting。

违反：

```text
能力与基础设施分离
逻辑与控制分离
单一职责
```

### 5.3 `analyzeNewHighs`

当前使用 SQL Window Function 同时完成：

- 前一交易日比较；
- 突破业务规则；
- 分组统计；
- 输出格式化。

该实现可以继续作为 legacy reporting 查询，但**不建议作为 MCP analytics 的核心能力**。

### 5.4 建议拆分

```text
MarketSeriesReader Port
        |
        v
Analytics Logic
  calculateReturns
  calculatePositiveRate
  detectBreakouts
  calculateDrawdowns
  calculateRecoveries
        |
        v
Application Use Cases
```

SQLite 可以继续提供一个 Adapter：

```text
SqliteMarketSeriesReader
```

但 Domain/Analytics 不应该知道：

```text
表 py
表 pd_xg
列 c1/c3/c12/c13
```

### 5.5 MCP 决策

**不要直接把 `src/stats/statistics.js` 包成 MCP Tool。**

第一阶段应新建共享 analytics capability，逐步让旧 CLI/report 也迁移过去。

---

## 6. `src/signals/` 盘点

虽然 MCP 初始 Phase 0 的主范围是 kline/stats/strategies/simulator，但策略查询必然经过 signals，因此补充检查。

### 6.1 可直接复用的纯逻辑

例如：

```text
src/signals/indicators/boll.js
```

`calculateBollWindow()` / `calculateBollSeries()`：

- 不读文件；
- 不访问数据库；
- 不访问网络；
- 输入确定；
- 输出确定。

这是 MCP Capability/Logic 的理想现状。

结论：

> BOLL 不需要重新实现，直接提升为共享权威能力。

### 6.2 `signals/daily.js`

当前同时包含：

```text
readJson / loadKlines / loadCandidateSeeds   Infrastructure
buildSignalContext                           Application
compareCandidates                            Business/Logic
materializeCandidate                         Projection Logic
summarizeCandidates                          Logic
runDailySignals                              Control/Application
```

问题：

- signal runner 自己读取 `data/kline` 与 `data/pool`；
- candidate ranking 和数据读取绑定在同一文件；
- MCP 如果直接调用 `runDailySignals()`，会把文件布局泄露进查询链路。

建议：

```text
SignalContextReader Port
CandidateSeedReader Port
        |
        v
RunDailySignalsUseCase
        |
        +-> SignalEvaluator Capability
        +-> CandidateRanking Logic
```

已有 signal evaluator/registry 应继续复用。

---

## 7. `src/strategies/` 盘点

### 7.1 总体结构

```text
strategy_builder.js
year_decline.js
year_decline_sync.js
v3/
  builtins.js
  catalog.js
  compiler.js
  migrate.js
  registry.js
```

V3 是当前最值得复用的能力层。

### 7.2 `v3/compiler.js`

优点：

- strategy definition normalization；
- capability registry；
- indicator/rule evaluation；
- requirements inference；
- ranking；
- yearly prefilter；
- 主要是确定性代码。

这是一个强 Capability/Logic 候选。

需要修正的边界：

```text
strategyError()
  -> error.statusCode = 422
```

`422` 是 HTTP Transport 语义，不应存在于策略 Domain/Compiler。

建议：

```text
Domain Error
  code
  message
  issues

HTTP Adapter
  Domain Error -> 422

MCP Adapter
  Domain Error -> MCP error/result
```

即：

> Compiler 决定“是什么错误”，Adapter 决定“协议如何表达错误”。

### 7.3 `strategy_builder.js`

现有文件约 32KB，包含：

- V2 catalog；
- templates；
- config normalization；
- indicator/rule semantics；
- compilation；
- V2/V3 compatibility；
- HTTP style `statusCode` error。

风险：

- 大量职责集中；
- 与 V3 有能力重复；
- 如果 MCP 直接依赖这里，后续会把兼容层变成永久核心。

决策：

```text
新 MCP -> 优先依赖 V3 shared capability
旧 V2 -> 保留兼容
migration -> 单独边界
```

不为 MCP 新增任何 V2 专用逻辑。

### 7.4 `year_decline_sync.js`

该文件负责：

- compile strategy；
- market scope；
- 创建 `ExistingKlineRepository`；
- 遍历代码；
- 读取年线；
- 运行 yearly prefilter；
- 构建 strategy universe。

它属于：

```text
Application + Control
```

而不是通用 Capability。

MCP `strategy_get_candidates` 不应通过该同步函数重新构建数据。

正确方式：

```text
StrategyCandidateReader Port
        |
        v
GetStrategyCandidatesUseCase
```

只读取已经生成的策略/信号结果。

### 7.5 Strategy Phase 0 决策

| 能力 | 决策 |
|---|---|
| V3 registry | 复用 |
| V3 indicator/rule logic | 复用 |
| V3 compiler | 复用，移除 transport error coupling |
| V2 compatibility | 保留，但 MCP 不新增依赖 |
| strategy sync | Control plane，不进入 MCP read path |
| strategy evidence | 作为 MCP 标准输出基础 |

---

## 8. `src/simulator/` 盘点

### 8.1 当前结构是正向范例

已有：

```text
core/
mechanisms/
application/
ports/
adapters/
selection/
data/
```

这与 MCP 设计要求高度一致。

### 8.2 `core/`

包括：

```text
account.js
order.js
position.js
session.js
market_clock.js
contracts.js
enums.js
```

分类：

```text
Business + Domain Logic
```

原则：继续保持无 MCP/HTTP/FS/SQLite 依赖。

### 8.3 `mechanisms/`

包括：

```text
a_share_rules.js
fee_model.js
fill_model.js
slippage_model.js
```

这些是很好的 Capability/Logic 候选，可被多个入口复用。

### 8.4 `ports/index.js`

已经定义：

```text
marketDataRepository
sessionRepository
```

这证明当前仓库已经接受 Port/Adapter 模式。

但 `marketDataRepository` 目前接口为：

```text
listAvailableCodes
getLegacyBar
getLegacyHistory
```

问题：

- 名称带 Simulator/Legacy 语义；
- 不适合作为长期全局 `KlineReader` 契约；
- MCP 不应该被 `Legacy*` 语义锁死。

建议：

保留兼容接口，同时新增更通用只读 Port：

```text
KlineReader
  getRange(...)
  getLatest(...)
  getCoverage(...)
```

`ExistingKlineRepository` 可以先实现新 Port，旧 Simulator 接口通过兼容方法继续工作。

### 8.5 `adapters/ledger/existing_kline_repository.js`

优点：

- 已封装文件路径；
- 已封装 sharded/legacy 路径；
- 有 cache；
- 有 content hash；
- 有 quality issues；
- 截止 `endDate` 截断，可防止未来数据泄漏。

因此这是 MCP 第一阶段最值得复用的基础设施之一。

需要避免：

- MCP 直接 new `ExistingKlineRepository`；
- Application 直接依赖 concrete class；
- 新 API 继续使用 `getLegacyHistory` 命名。

目标：

```text
KlineReader Port
      ^
      |
LedgerKlineReader Adapter
      |
内部可复用 ExistingKlineRepository
```

### 8.6 `adapters/ledger/existing_universe.js`

同样已经封装：

- universe snapshot；
- pool fallback；
- kline-derived fallback；
- survivorship bias quality issue。

这是很好的 Infrastructure Adapter，可作为后续 `SecurityUniverseReader` 的实现基础。

### 8.7 `application/runtime_service.js`

当前文件约 68KB，import 范围包括：

```text
fs/path
core entities
ledger adapters
selection
BOLL
orders/sessions/reports
HTTP DTO
data status
proxy quality
strategy sync
fees
strategy builder
```

并且内部包含：

- HTTP style error；
- DTO；
- chart logic；
- BOLL；
- account/order/session；
- strategy state；
- data status；
- proxy quality；
- strategy sync。

这是当前最大的“应用服务聚合点”。

结论：

> MCP 不得把 `SimulatorRuntimeService` 当成共享 Domain API。

否则 MCP 会间接依赖：

```text
HTTP DTO
FS
Proxy
Sync
UI projection
Simulator lifecycle
```

应当从 Runtime Service 中逐步抽出窄用例，而不是继续向它添加 MCP 方法。

MCP 首期模拟能力建议新建：

```text
SimulateDrawdownBuyingUseCase
```

它仅依赖：

```text
KlineReader
DrawdownBuyingPolicy
Position/Trade Calculation Capability
Return/Drawdown Capability
```

不依赖整个 SimulatorRuntimeService。

---

## 9. 现有代码分类总表

| 路径/模块 | 当前主分类 | 主要问题 | 处理 |
|---|---|---|---|
| `signals/indicators/boll.js` | Logic/Capability | 基本无 | 直接复用 |
| `strategies/v3/compiler.js` | Capability/Logic | HTTP `statusCode` 泄漏 | 小幅抽边界 |
| `strategies/v3/registry.js` | Capability | 无明显问题 | 复用 |
| `strategies/strategy_builder.js` | Capability + compatibility | 职责偏大、V2/V3 混合 | MCP 只走 V3 |
| `strategies/year_decline_sync.js` | Control/Application | concrete repository + sync | 不进 MCP read path |
| `kline/aggregate_yearly.js` | Logic + Infra + Control | 混层 | 渐进拆分 |
| `kline/freshness.js` | Logic + Infra + Command | Query/Command 混合 | 抽 classifier/port |
| `kline/data_status.js` | Infra + Application + Control | 扫描/cache/paging 混合 | 抽 inventory port |
| `kline/engine_selection.js` | Control + Infra | 网络探测 | MCP 不依赖 |
| `stats/statistics.js` | Business + SQL + Presentation | 强耦合 | 不直接复用 |
| `signals/daily.js` | Infra + App + Business Logic | FS 与 signal orchestration 混合 | 抽 reader/use case |
| `simulator/core/*` | Business/Logic | 边界较好 | 保持 |
| `simulator/mechanisms/*` | Capability/Logic | 边界较好 | 复用 |
| `simulator/ports/index.js` | Ports | 接口偏 simulator/legacy | 新增通用 Port |
| `simulator/adapters/ledger/*` | Infrastructure | 命名偏 Simulator | 作为实现基础复用 |
| `simulator/application/runtime_service.js` | Control/Application 聚合 | 过大、跨域依赖多 | 不作为 MCP 门面 |

---

## 10. MCP 第一阶段需要的共享 Port

不要一次设计几十个 Port。

第一阶段只建立真正需要的四个：

### 10.1 `KlineReader`

职责：读取已经存在的行情账本。

建议契约：

```js
getRange({
  security,
  period,
  start,
  end,
  limit,
})

getLatest({
  security,
  period,
  asOf,
})

getCoverage({
  security,
  period,
})
```

要求：

- 不触发同步；
- 不访问网络；
- 结果带 price view / quality / source；
- `end/asOf` 必须强制截断未来数据。

### 10.2 `SecurityReader`

职责：证券身份与可用数据范围。

可基于：

```text
SecurityIdentityDirectory
ExistingUniverseRepository
```

逐步实现。

### 10.3 `StrategyReader`

职责：读取策略定义、revision、active revision。

不负责：

- 编译；
- 修改；
- 同步；
- rebuild。

### 10.4 `SignalReader`

职责：读取某策略、某日期的已生成候选与 evidence。

不负责：

- 重新抓行情；
- 触发 strategy sync；
- 自动修复数据。

---

## 11. 第一批共享 Logic / Capability

第一阶段只确认以下权威实现：

```text
Kline normalization
BOLL
Drawdown
Recovery
Return
Strategy V3 evaluation
Candidate evidence projection
```

其中：

### 已存在可直接复用

```text
BOLL
Strategy V3 evaluation
Kline normalization（已有实现，需统一入口）
```

### 需要新增

```text
DrawdownCalculator
RecoveryCalculator
ReturnCalculator
```

新增能力必须满足：

```text
无 fs
无 SQL
无 HTTP
无 MCP
无 Eastmoney
无 AWS
无 GitHub
无 retry
```

---

## 12. 第一条垂直切片

Phase 1 不先实现 MCP Server 全家桶。

第一条垂直切片固定为：

```text
Ledger Kline Files
      |
      v
LedgerKlineReader
      |
      v
KlineReader Port
      |
      v
AnalyzeDrawdownsUseCase
      |
      v
DrawdownCalculator
      |
      v
MCP analytics_get_drawdowns
```

每层职责：

### `LedgerKlineReader`

只负责：

- 找文件；
- 读取；
- normalize；
- quality metadata；
- time truncation。

### `DrawdownCalculator`

只负责：

```text
price sequence -> drawdown events
```

### `AnalyzeDrawdownsUseCase`

只负责：

```text
validate application request
-> KlineReader
-> DrawdownCalculator
-> application result
```

### MCP Tool

只负责：

```text
MCP schema
-> request mapping
-> use case
-> MCP presenter
```

---

## 13. 推荐目录演进

不立即迁移所有旧代码，采用渐进式新增共享边界：

```text
src/
  application/
    market/
    analytics/
    strategy/
    simulation/

  capabilities/
    analytics/
      drawdown.js
      recovery.js
      returns.js

  ports/
    market/
      kline_reader.js
      security_reader.js
    strategy/
      strategy_reader.js
      signal_reader.js

  adapters/
    ledger/
      kline_reader.js
      security_reader.js
      strategy_reader.js
      signal_reader.js

  mcp/
    server.js
    tools/
    schemas/
    presenters/
    errors/
```

现有：

```text
src/simulator/*
src/signals/*
src/strategies/*
src/kline/*
```

先不整体移动。

当某项能力被抽成共享实现后，再让旧入口逐步反向复用新能力。

---

## 14. 重构优先级

### P0：开始 MCP 前必须完成

#### P0-1 通用 `KlineReader` Port

目标：MCP/Application 不直接依赖 `ExistingKlineRepository` concrete class。

#### P0-2 `LedgerKlineReader`

复用现有 `ExistingKlineRepository` 的：

- 文件路径；
- cache；
- normalize；
- hash；
- quality；
- as-of truncation。

但暴露通用 `KlineReader` 契约。

#### P0-3 `DrawdownCalculator`

纯逻辑，无 IO。

#### P0-4 `AnalyzeDrawdownsUseCase`

负责业务用例编排。

#### P0-5 Boundary Tests

保证：

```text
DrawdownCalculator 不 import fs/sql/http/mcp
UseCase 不 import ledger concrete adapter
MCP Tool 不 import fs/db/source
```

### P1：第一个 MCP Tool 之后

- `RecoveryCalculator`；
- `ReturnCalculator`；
- `analytics_get_recovery_periods`；
- BOLL Application wrapper；
- `market_get_kline`；
- `market_get_summary`。

### P1：Strategy Read Path

- `StrategyReader`；
- `SignalReader`；
- `strategy_list`；
- `strategy_get_candidates`；
- `strategy_explain_signal`；
- Domain error 与 HTTP statusCode 解耦。

### P2

- 拆 `stats/statistics.js`；
- 拆 `signals/daily.js` 文件 IO；
- 缩小 `SimulatorRuntimeService`；
- 旧 CLI / HTTP 逐步复用共享 Application。

---

## 15. 明确禁止的捷径

### 禁止 1：MCP 直接使用 `ExistingKlineRepository`

错误：

```text
MCP Tool -> new ExistingKlineRepository()
```

正确：

```text
MCP -> UseCase -> KlineReader Port <- LedgerKlineReader
```

### 禁止 2：MCP 直接调用 `SimulatorRuntimeService`

Runtime Service 是完整模拟器应用门面，不是共享 Domain API。

### 禁止 3：把 SQL 当 Domain API

```text
MCP -> stats/statistics.js -> queryDatabase
```

不允许。

### 禁止 4：为 MCP 复制 BOLL

已有纯实现必须复用。

### 禁止 5：Tool 查询时自动补数据

查询只读：

```text
missing/stale -> 返回 quality/meta
```

而不是：

```text
missing -> 自动 Eastmoney/AWS sync
```

### 禁止 6：Application 含协议语义

禁止：

```js
error.statusCode = 422
```

出现在 Domain/Capability/Application 核心错误中。

HTTP/MCP 各自负责映射。

---

## 16. Architecture Fitness Checks

Phase 1 开始后应逐步自动化检查。

### 16.1 Capability/Logic 禁止依赖

扫描：

```text
src/capabilities/**
src/strategies/v3/** 的纯逻辑部分
```

禁止 import：

```text
node:fs
node:path（仅纯路径值对象例外，尽量避免）
better-sqlite3
fastify
@modelcontextprotocol/*
aws sdk
sources/eastmoney
```

### 16.2 MCP 禁止依赖

```text
src/mcp/**
```

禁止直接 import：

```text
node:fs
src/db/*
src/sources/*
src/aws/*
src/huaweicloud/*
src/kline/engines/*
```

### 16.3 Application 禁止 concrete infrastructure

例如：

```text
src/application/analytics/analyze_drawdowns.js
```

不得：

```js
require("../../simulator/adapters/ledger/existing_kline_repository")
```

只允许依赖 Port contract。

---

## 17. 第一阶段验收标准

完成第一条垂直切片时必须满足：

1. `analytics_get_drawdowns` 不直接访问文件。
2. `AnalyzeDrawdownsUseCase` 不知道文件路径。
3. `DrawdownCalculator` 可用纯数组 Fixture 测试。
4. Ledger Adapter 可单独做文件契约测试。
5. 同一 Drawdown 算法只有一个权威实现。
6. HTTP/CLI 如未来需要 Drawdown，能够直接复用相同 Use Case/Capability。
7. MCP 查询不会触发任何外部数据同步。
8. 所有历史查询按 `as_of/end` 截断，不能读取未来数据。
9. 数据缺失返回结构化 quality，不静默补全。
10. 第一条垂直切片完成前，不增加第二套 Repository 或第二套指标算法。

---

## 18. Phase 0 最终决策

### 保留并复用

```text
signals/indicators/boll.js
strategies/v3 registry/compiler/evaluator 主体
simulator/core
simulator/mechanisms
simulator ledger adapter 的成熟实现思想
```

### 抽边界后复用

```text
ExistingKlineRepository
ExistingUniverseRepository
kline freshness/data status
signals daily pipeline
```

### 不作为 MCP 核心 API

```text
stats/statistics.js
SimulatorRuntimeService
strategy sync orchestrator
kline engine selection
AWS/Huawei/proxy sync chain
```

### 新增的最小共享层

```text
KlineReader Port
LedgerKlineReader Adapter
DrawdownCalculator
AnalyzeDrawdownsUseCase
```

然后才新增：

```text
analytics_get_drawdowns MCP Tool
```

---

## 19. 下一步

Phase 0 完成后，正式进入 Phase 1 第一条垂直切片。

实现顺序固定为：

```text
1. 定义 KlineReader Port
2. 实现 LedgerKlineReader Adapter
3. 增加 adapter contract tests
4. 实现 DrawdownCalculator
5. 增加纯逻辑单元测试
6. 实现 AnalyzeDrawdownsUseCase
7. 增加 use-case tests（fake KlineReader）
8. 增加 boundary dependency tests
9. 最后实现 analytics_get_drawdowns MCP Tool
10. 增加 MCP schema/contract tests
```

在第 1～8 步完成前，不先搭建大量 MCP Tool。

这样可以确保第一项能力就验证：

```text
关注点分离
单一职责
能力与业务分离
逻辑与控制分离
```

而不是等 MCP 功能堆积后再重构。
