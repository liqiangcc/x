# MCP 化架构设计

> 日期：2026-08-12  
> 状态：设计草案  
> 目标：在不复制股票业务逻辑、不破坏现有 CLI / Simulator / GitHub Actions 行为的前提下，为 AI 提供稳定、只读、可验证的股票数据与分析能力。

## 1. 背景

`x` 已经从脚本集合演进为 Node.js-first 的股票数据账本、数据同步、信号研究、策略编排和历史交易模拟平台。现有能力已经分散在 `src/kline/`、`src/stats/`、`src/signals/`、`src/strategies/`、`src/simulator/` 等模块中。

下一阶段增加 MCP 的目的不是“再实现一套股票分析系统”，而是增加一个面向 AI 的协议适配入口，使 ChatGPT、Codex 或其他 MCP Client 能够：

- 查询证券与 K 线数据；
- 调用确定性的统计与技术指标能力；
- 查询策略候选和信号证据；
- 调用历史模拟/定投类计算用例；
- 获取数据时间边界、质量与来源信息；
- 在 AI 推理之前获得可复现的结构化结果。

MCP 必须建立在现有领域能力之上，而不是直接耦合 `data/` 文件布局。

## 2. 设计目标

### 2.1 核心目标

1. **关注点分离（Separation of Concerns）**：协议、控制、业务、能力、逻辑、数据访问、存储实现相互隔离。
2. **单一职责原则（Single Responsibility Principle）**：每个模块只有一种主要变化原因。
3. **能力与业务分离**：能力描述“系统能做什么”，业务描述“为什么以及如何组合这些能力”；通用能力不得携带具体投资场景语义。
4. **逻辑与控制分离**：逻辑只负责确定性计算，控制只负责调用顺序、生命周期、失败处理和协议编排；控制层不得包含业务判断。
5. **复用现有能力**：CLI、HTTP Simulator、GitHub Actions、MCP 共用同一组 Application / Domain 能力。
6. **确定性优先**：收益率、回撤、BOLL、恢复周期、策略匹配等计算由程序完成，AI 负责解释、比较和推理。
7. **只读优先**：第一阶段 MCP 不触发数据同步、不修改策略、不修改仓库、不执行交易。
8. **数据可信**：每个关键结果携带 `as_of`、数据质量、数据来源与必要警告。
9. **可测试**：MCP Tool 可以在不读取真实文件、不访问网络的情况下完成契约测试。
10. **渐进式演进**：不要求为了 MCP 立即重构全部现有目录。

### 2.2 非目标

第一阶段明确不做：

- 自动交易、下单或券商连接；
- AI 自主修改策略；
- MCP 内部直接抓取 Eastmoney 或调用云函数补数据；
- MCP 内部实现第二套指标/策略/模拟算法；
- MCP Tool 直接读写 `data/**/*.json` / CSV；
- 通过单个“万能 Tool”承担所有分析；
- 远程多租户权限系统；
- 让模型自己对大批原始 K 线进行精确数学计算。

## 3. 强制架构原则

### 3.1 依赖方向

依赖只能由外向内：

```text
AI / MCP Client
      |
      v
MCP Adapter
      |
      v
Application Use Cases
      |
      +--------------------+
      v                    v
Domain Capabilities       Ports
(stats/signals/strategy)    |
                           v
                    Infrastructure Adapters
                           |
                           v
                    Repo Data Ledger / DB
```

禁止反向依赖：

- Domain 不允许 import MCP SDK。
- Domain 不允许 import Fastify、文件系统、SQLite 或 GitHub API。
- Application 不允许解析 MCP protocol payload。
- MCP Adapter 不允许知道具体 JSON 文件路径。
- Repository Adapter 不允许包含回撤、BOLL、策略匹配等业务算法。

### 3.2 能力与业务分离

能力（Capability）描述**系统能做什么**，必须是稳定、通用、可复用、可组合的原子能力；业务（Business）描述**为什么调用这些能力，以及如何按照业务规则组合这些能力**。

推荐的能力：

```text
KlineReader
SecurityReader
DrawdownCalculator
RecoveryCalculator
BollingerCalculator
ReturnCalculator
ThresholdDetector
PositionCalculator
StrategyEvaluator
SignalReader
```

这些能力不得知道具体投资场景，例如：

```text
医疗 ETF 加仓
每跌 8% 买 10%
连续下跌三年后突破
月线突破 BOLL 中轨后买入
```

上述内容属于业务规则或业务用例，应由 Application / Business Policy 组合通用能力完成。例如：

```text
SimulateDrawdownBuying
  -> KlineReader
  -> ThresholdDetector
  -> PositionCalculator
  -> ReturnCalculator
  -> TradeSimulation Capability
```

禁止以业务场景命名通用能力，例如：

```text
EightPercentBuyCalculator      # 禁止
MedicalEtfAnalyzer             # 禁止
ThreeYearDeclineStockCalculator # 禁止
```

应拆为通用能力与业务规则：

```text
ThresholdDetector
DrawdownCalculator
PositionCalculator
ReturnCalculator

DrawdownBuyingPolicy
ThreeYearDeclineBreakoutPolicy
BollingerEntryPolicy
```

判断标准：**如果一个能力因为某个具体策略、ETF、阈值或投资场景变化而必须修改，该能力边界通常已经混入业务语义。**

### 3.3 逻辑与控制分离

逻辑（Logic）负责“结果怎么算出来”，控制（Control）负责“什么时候、按什么顺序、调用什么、失败后怎么办”。两者必须分离。

逻辑层应尽量保持纯函数式：

```text
Input
  -> deterministic calculation
  -> Output
```

例如：

```text
calculateDrawdowns(prices, options)
calculateBollinger(prices, window, multiplier)
evaluateThreshold(previous, current, threshold)
```

逻辑层不得包含：

- 文件读取；
- SQL；
- 网络请求；
- MCP / HTTP 协议处理；
- retry / backoff；
- 日志生命周期；
- AWS region 选择；
- workflow dispatch；
- Git 操作；
- “跌 8% 就买 10%”之类业务控制判断。

控制层负责：

- 参数校验后的调用编排；
- 调用顺序；
- Port / Capability 选择；
- 超时、取消、重试策略；
- 错误分类和边界映射；
- request / response 生命周期；
- 将业务用例暴露给 MCP / CLI / HTTP / Actions。

但控制层不得包含业务规则。例如下面的代码不得出现在 MCP Controller、HTTP Controller、CLI Handler 或 Workflow Controller 中：

```js
if (drawdown >= 0.08) {
  buy(0.10);
}
```

控制层只能调用：

```js
const decision = buyingPolicy.evaluate(context);
```

推荐调用关系：

```text
MCP / CLI / HTTP
      |
      v
Controller / Adapter
      |
      v
Application Use Case
      |
      +--------------------+
      v                    v
Business Policy        Capabilities
      |                    |
      +---------+----------+
                v
           Pure Logic
                |
                v
              Ports
                |
                v
         Infrastructure
```

这里不是要求每个请求机械经过所有层，而是明确变化原因和依赖边界：业务可以组合多个能力，能力可以复用纯逻辑，控制只负责调度，不拥有业务规则。

### 3.4 MCP 是 Adapter，不是业务层

MCP Tool 的职责只有：

```text
MCP Input
  -> Schema validation / normalization
  -> Application Request DTO
  -> invoke Use Case
  -> MCP Result Presenter
```

MCP Tool 不得：

- 读取 `data/`；
- 执行 SQL；
- 请求行情网站；
- 计算回撤；
- 计算指标；
- 判断策略命中；
- 生成成交；
- 操作 Git。

### 3.5 一个 Use Case 只解决一个问题

推荐：

```text
GetSecurityProfile
GetKlineRange
GetMarketSummary
AnalyzeDrawdowns
AnalyzeRecoveryPeriods
CalculateBollinger
ListStrategies
GetStrategyCandidates
ExplainStrategySignal
SimulateDrawdownBuying
```

不推荐：

```text
AnalyzeStock
DoEverything
QueryAndSyncStock
StrategyAndSimulation
```

判断标准：如果一个类因为两种互不相关的原因频繁修改，应继续拆分。

### 3.6 领域算法保持纯净

例如：

```text
DrawdownAnalyzer
RecoveryAnalyzer
BollingerCalculator
ReturnCalculator
StrategyEvaluator
```

只接收领域输入并返回领域结果，不关心数据来自 Git、JSON、SQLite、HTTP、MCP 或测试 Fixture。

### 3.7 数据访问必须经过 Port

Application 依赖接口/Port，不依赖具体存储：

```text
KlineReader
SecurityReader
StrategyReader
SignalReader
SimulationDataReader
```

实现可以逐步提供：

```text
LedgerKlineReader
SqliteKlineReader
LedgerStrategyReader
SqliteStrategyReader
```

因此未来从 JSON 切换 SQLite / DuckDB 时，上层 Tool 契约保持稳定。

### 3.8 Architecture Fitness Rules

以下规则不是建议，而是新代码的架构约束；能自动化检查的应逐步进入 CI：

```text
RULE-01 Capability 不得依赖具体业务场景、策略名、证券类型或固定阈值。
RULE-02 Business 不得复制已有通用能力或确定性算法。
RULE-03 Logic 不得包含 IO、协议、重试、日志生命周期或流程控制。
RULE-04 Controller / MCP / CLI / HTTP / Actions 不得包含业务规则。
RULE-05 MCP Tool 不得直接读取 data/。
RULE-06 MCP Tool 不得直接访问 SQLite 或其他具体存储。
RULE-07 Infrastructure 不得决定策略、买卖、筛选或风险业务规则。
RULE-08 Domain / Logic 不得依赖 MCP、HTTP、GitHub、AWS、文件系统或数据库实现。
RULE-09 同一确定性能力只能有一个权威实现，Adapter 不得复制算法。
RULE-10 所有入口优先复用同一 Application / Capability，不允许为 MCP 建第二套业务链路。
```

代码评审时，任何违反规则的实现都应先调整边界，再继续扩展功能。

## 4. 与现有 `x` 的关系

MCP 不要求立即把现有代码全部迁移为 DDD 目录。第一阶段采用“边界先行、渐进抽取”。

现有模块继续作为能力来源：

```text
src/kline/       行情与 K 线能力
src/stats/       统计能力
src/signals/     信号能力
src/strategies/  策略能力
src/simulator/   历史交易模拟能力
src/db/          数据库基础设施
```

新增的共享边界建议：

```text
src/application/
  market/
  analytics/
  strategy/
  simulation/

src/ports/
  market/
  strategy/
  signal/

src/adapters/
  ledger/
  sqlite/

src/mcp/
  server.js
  tools/
  schemas/
  presenters/
  errors/
```

若现有模块已有稳定 Port / Adapter，则优先复用，不重复创建抽象。

### 4.1 最终入口关系

```text
                     +-> CLI Adapter
                     |
Domain/Application --+-> HTTP/Simulator Adapter
                     |
                     +-> MCP Adapter
                     |
                     +-> GitHub Actions Adapter
```

所有入口都调用共享能力。

## 5. MCP Tool 设计规范

### 5.1 Tool 粒度

一个 Tool 解决一个明确问题，名称体现领域 + 动作。

第一阶段建议：

```text
market_get_security
market_get_kline
market_get_summary

analytics_get_drawdowns
analytics_get_recovery_periods
analytics_get_bollinger

strategy_list
strategy_get_candidates
strategy_explain_signal

simulation_run_drawdown_buying
```

### 5.2 禁止万能接口

禁止：

```text
analyze_stock(code, analysis=[...])
```

原因：

- 参数持续膨胀；
- 职责不清晰；
- 难以做权限隔离；
- 难以做契约测试；
- AI 不容易判断应该何时调用；
- 一个子能力变化可能影响全部调用方。

### 5.3 Tool 不等于 Domain Function

MCP Tool 可以编排一个 Application Use Case，但不能直接暴露内部函数细节。

例如：

```text
analytics_get_drawdowns
      |
      v
AnalyzeDrawdownsUseCase
      |
      +-> KlineReader
      +-> DrawdownAnalyzer
```

这样 HTTP / CLI 未来也可以复用 `AnalyzeDrawdownsUseCase`。

## 6. 第一阶段 Tool 契约

### 6.1 `market_get_security`

用途：查询证券基本标识和账本可用数据范围。

输入示例：

```json
{
  "code": "512010"
}
```

输出核心字段：

```json
{
  "security": {
    "code": "512010",
    "name": "...",
    "market": "...",
    "type": "etf"
  },
  "coverage": {
    "daily_from": "YYYY-MM-DD",
    "daily_to": "YYYY-MM-DD"
  },
  "meta": {}
}
```

### 6.2 `market_get_kline`

用途：读取指定时间范围的 K 线。

输入：

```json
{
  "code": "512010",
  "period": "daily",
  "start": "2025-01-01",
  "end": "2026-08-12",
  "adjustment": "ledger_default",
  "limit": 500
}
```

约束：

- 必须限制最大返回记录数；
- 大范围查询支持分页/游标；
- 不能因为缺少数据自动触发同步；
- 返回数据必须说明复权/价格口径。

### 6.3 `market_get_summary`

用途：返回 AI 常用的稳定摘要，避免模型为基础统计重复拉全量 K 线。

可包含：

- 最新账本日期；
- 最近收盘；
- 区间涨跌幅；
- 区间最高/最低；
- 数据覆盖与质量。

该 Tool 只能调用既有确定性计算能力，不应重新实现算法。

### 6.4 `analytics_get_drawdowns`

输入示例：

```json
{
  "code": "512010",
  "start": "2020-01-01",
  "end": "2026-08-12",
  "min_drawdown": 0.10
}
```

输出事件：

```json
{
  "events": [
    {
      "peak_date": "YYYY-MM-DD",
      "peak_price": 0,
      "trough_date": "YYYY-MM-DD",
      "trough_price": 0,
      "drawdown": -0.18,
      "recovery_date": "YYYY-MM-DD",
      "recovery_trading_days": 0
    }
  ],
  "meta": {}
}
```

### 6.5 `analytics_get_recovery_periods`

职责只回答“从指定回撤/低点恢复需要多久”。

不得和回撤 Tool 合并成一个不断膨胀的超级结果；两者可以共享 Domain 能力。

### 6.6 `analytics_get_bollinger`

输入必须显式包含：

- period；
- window；
- standard deviation multiplier；
- price field；
- as-of date / end date。

历史查询必须保证不读取 `as_of` 之后的数据。

### 6.7 `strategy_list`

返回：

- strategy id；
- 名称；
- revision；
- active revision；
- 配置摘要；
- 能力/质量要求。

不返回 UI 专属字段。

### 6.8 `strategy_get_candidates`

输入示例：

```json
{
  "strategy_id": "...",
  "date": "2026-08-11",
  "limit": 100
}
```

输出必须复用策略引擎已经生成的标准 evidence，不重新解释策略配置。

### 6.9 `strategy_explain_signal`

职责：返回“为什么某证券在某日期命中/未命中”。

输出应是结构化证据，不直接生成自然语言投资建议。

建议字段：

```json
{
  "matched": true,
  "rules": [],
  "ranking": [],
  "data_quality": [],
  "as_of": "YYYY-MM-DD"
}
```

自然语言解释留给 AI。

### 6.10 `simulation_run_drawdown_buying`

用于“下跌 N% 加一份”类研究。

输入示例：

```json
{
  "code": "512010",
  "start_date": "2025-09-01",
  "end_date": "2026-08-12",
  "initial_allocation": 0.10,
  "add_rule": {
    "reference": "last_entry",
    "drawdown": 0.08,
    "allocation": 0.10
  },
  "max_entries": 10
}
```

输出至少包括：

- 买入日期；
- 买入价格；
- 单次/累计仓位；
- 平均成本；
- 最大浮亏；
- 期末收益；
- 回本日期；
- 数据口径与质量。

该 Tool 必须调用 Simulator/Application 能力；不得在 MCP 目录内写一套新的交易模拟器。

## 7. 统一结果元数据

所有会影响 AI 判断的 Tool 应尽量使用统一 `meta`：

```json
{
  "meta": {
    "as_of": "2026-08-11",
    "data_source": "repo_ledger",
    "data_revision": "optional-id",
    "quality": "ok",
    "quality_labels": [],
    "adjustment": "ledger_default",
    "warnings": []
  }
}
```

原则：

1. **不伪装精确性**：现有数据只能提供 `legacy_approximate` 时必须明确返回。
2. **时间边界显式**：历史分析必须返回 `as_of`。
3. **来源显式**：AI 能判断结果来自本地账本，而不是实时行情。
4. **口径显式**：复权方式、价格字段、交易日口径不能隐式变化。

## 8. 错误模型

MCP Adapter 负责把 Application Error 映射为稳定错误类型：

```text
INVALID_ARGUMENT
SECURITY_NOT_FOUND
DATA_NOT_FOUND
DATA_INCOMPLETE
UNSUPPORTED_PERIOD
CAPABILITY_UNAVAILABLE
INTERNAL_ERROR
```

数据质量警告优先作为成功响应中的 `meta.quality_labels` / `warnings`，除非缺失已经导致结果不能被正确计算。

禁止把底层：

```text
ENOENT
SQLITE_BUSY
JSON.parse error
Eastmoney 502
```

直接泄漏为 MCP 公共契约。

详细底层异常只进入诊断日志。

## 9. 读写边界

### 9.1 第一阶段严格只读

允许：

- 查询账本；
- 查询策略；
- 查询信号；
- 执行无副作用的确定性分析；
- 运行内存/临时模拟。

禁止：

- `git commit` / `git push`；
- 修改策略；
- 修改模板；
- 写入 `data/`；
- 自动触发 daily sync；
- 删除数据；
- 下单。

### 9.2 后续如果增加写能力

不能把写能力偷偷塞进现有只读 Tool。

建议独立 namespace / server，例如：

```text
x-stock-readonly-mcp
x-stock-admin-mcp
```

或者至少独立 capability 开关和权限策略。

## 10. 时间与未来数据约束

股票研究最重要的正确性之一是避免未来数据泄漏。

所有历史 Tool 必须遵守：

```text
requested_as_of = T
=> 所有输入数据 timestamp/date <= T
```

Application 层负责传递时间边界，Repository Adapter 负责执行边界，Domain 不允许偷偷读取“最新值”。

策略、指标与模拟器必须保持现有时间截断原则。

验收测试必须包含“未来一天的数据存在于账本，但历史调用不可见”的 Fixture。

## 11. 性能与上下文控制

MCP 的目标不是把整个仓库塞给模型。

### 11.1 原始数据限制

- K 线默认限制记录数；
- 支持明确日期范围；
- 超限返回游标/提示缩小范围；
- 不允许一次返回全市场所有历史 K 线。

### 11.2 优先返回分析结果

当用户问题是“最大回撤是多少”，AI 应调用：

```text
analytics_get_drawdowns
```

而不是：

```text
market_get_kline -> 模型自己计算
```

这样同时降低 token 使用和数学误差。

### 11.3 缓存边界

缓存属于 Infrastructure，不属于 MCP Tool 或 Domain。

缓存 Key 至少考虑：

```text
capability + security + range + params + data_revision
```

数据版本变化后不能继续返回旧结果。

## 12. 可观测性

MCP Server 记录：

- tool name；
- request id；
- duration；
- success/error category；
- result size；
- repository/data revision；
- application use case。

默认不记录完整的大型 K 线响应。

日志不得与 Tool 返回契约耦合。

## 13. 测试策略

### 13.1 Domain 单元测试

测试纯计算：

```text
DrawdownAnalyzer
RecoveryAnalyzer
BollingerCalculator
StrategyEvaluator
```

不启动 MCP Server，不访问文件系统。

### 13.2 Application 测试

使用 Fake Port：

```text
FakeKlineReader
FakeStrategyReader
FakeSignalReader
```

验证：

- 编排是否正确；
- 时间边界是否传递；
- 数据质量是否保留；
- 错误是否正确分类。

### 13.3 Adapter 集成测试

验证 Ledger/SQLite Adapter：

- 正常文件；
- 缺失文件；
- 空数据；
- 非法数据；
- 时间截断；
- 质量标签。

### 13.4 MCP 契约测试

每个 Tool 至少覆盖：

- schema 正常输入；
- schema 非法输入；
- not found；
- incomplete data；
- 正常结果 shape；
- 统一 meta；
- 错误映射；
- max result limit。

MCP Tool 测试通过 mock Use Case 完成，不依赖真实 `data/`。

### 13.5 架构边界测试

建议增加自动检查，阻止以下依赖进入主分支：

```text
src/mcp/**        -> data/** 直接文件访问
src/mcp/**        -> 指标 / 策略 / 回撤算法实现
src/domain/**     -> mcp / fastify / fs / sqlite / github / aws
src/logic/**      -> fs / sqlite / http / mcp / workflow
src/adapters/**   -> 业务策略判断
controllers       -> 固定业务阈值 / 买卖规则 / 策略条件
```

除 import/require 扫描外，应逐步增加语义边界测试：

- Capability 单元测试不引用具体策略名称和投资场景；
- Logic 测试全部使用内存输入输出，不需要 mock 文件系统或网络；
- Controller 测试通过 Fake Use Case 验证编排，不验证指标公式；
- Business Policy 测试只验证业务规则组合，不测试协议和存储；
- 同一个计算能力在 MCP / CLI / HTTP 调用下必须得到一致结果。

可以先用轻量 Node 测试扫描 import/require，后续再升级为专门依赖规则工具。

## 14. 建议目录结构

第一阶段推荐最小新增：

```text
src/
  application/
    market/
    analytics/
    strategy/
    simulation/

  ports/
    market/
    strategy/
    signal/

  adapters/
    ledger/
    sqlite/

  mcp/
    server.js
    tools/
      market-get-security.js
      market-get-kline.js
      market-get-summary.js
      analytics-get-drawdowns.js
      analytics-get-recovery-periods.js
      analytics-get-bollinger.js
      strategy-list.js
      strategy-get-candidates.js
      strategy-explain-signal.js
      simulation-run-drawdown-buying.js
    schemas/
    presenters/
    errors/
```

注意：这是**目标边界**，不是要求立刻把现有模块整体搬目录。优先通过 Adapter / Port 把现有能力接进来。

## 15. 示例调用链

### 15.1 回撤分析

```text
AI
 -> analytics_get_drawdowns Tool
 -> AnalyzeDrawdownsUseCase
 -> KlineReader
 -> DrawdownAnalyzer
 -> DrawdownResult
 -> MCP Presenter
 -> AI
```

变化原因隔离：

```text
MCP schema 变化        -> MCP
Kline 存储变化         -> Adapter
回撤算法变化           -> Domain
用例业务边界变化       -> Application
```

### 15.2 策略解释

```text
AI
 -> strategy_explain_signal Tool
 -> ExplainStrategySignalUseCase
 -> StrategyReader / SignalReader
 -> existing strategy evidence
 -> normalized result
 -> AI natural-language explanation
```

MCP 不重新编译或解释具体策略语义。

### 15.3 下跌加仓模拟

```text
AI
 -> simulation_run_drawdown_buying
 -> SimulateDrawdownBuyingUseCase
 -> historical Kline Port
 -> simulator/domain mechanism
 -> simulation result
 -> AI comparison / explanation
```

## 16. 关键禁止事项

以下内容应作为 Code Review Checklist：

1. 禁止 MCP Tool 直接访问 `data/`。
2. 禁止 MCP Tool 直接访问 SQLite。
3. 禁止 MCP Tool 调用外部行情 API。
4. 禁止在 MCP 目录实现指标、回撤、策略、成交算法。
5. 禁止 Domain import MCP / HTTP / FS / DB 具体实现。
6. 禁止 Capability 携带具体策略、证券、固定阈值或投资场景语义。
7. 禁止 Business 重复实现已有通用 Capability。
8. 禁止 Logic 包含 IO、重试、网络、协议、日志生命周期和流程编排。
9. 禁止 Controller / MCP / CLI / HTTP / Actions 写入策略条件、买卖判断或固定业务阈值。
10. 禁止 Infrastructure 决定业务策略。
11. 禁止一个 Tool 同时做查询、同步、计算、写入。
12. 禁止历史分析读取 `as_of` 之后的数据。
13. 禁止隐藏数据质量问题。
14. 禁止为了 MCP 复制现有策略 evidence 逻辑。
15. 禁止 Tool 返回无上限的大型原始数据。
16. 禁止把 Tool 输出文案当成投资建议；Tool 输出事实和确定性结果。
17. 禁止第一阶段 MCP 修改仓库或交易状态。
18. 禁止同一确定性计算在 MCP、CLI、HTTP 中出现多个实现版本。

## 17. 分阶段实施

### Phase 0：边界准备

目标：在写 MCP Server 之前先确认共享能力边界。

任务：

- 盘点 Kline / stats / strategy / signal / simulator 可复用入口；
- 将现有实现按“Business / Capability / Logic / Control / Infrastructure”标记归类；
- 识别目前混在 Controller、脚本或 Adapter 中的业务规则和确定性算法；
- 为数据读取定义最小 Port；
- 抽出第一批通用 Capability 和纯 Logic，禁止按具体策略场景命名；
- 为第一批分析建立 Application Use Case / Business Policy；
- 避免大规模目录重构，只先建立依赖边界。

完成条件：

- Application 用例可以通过 Fake Port 独立测试；
- Capability / Logic 可以脱离 MCP、文件系统和数据库测试；
- Controller 不包含具体股票业务判断；
- 同一能力可以被至少两个入口或测试直接复用，而无需复制实现。

### Phase 1：只读行情 + 分析 MCP

实现：

```text
market_get_security
market_get_kline
market_get_summary
analytics_get_drawdowns
analytics_get_recovery_periods
analytics_get_bollinger
```

完成条件：AI 不需要理解仓库文件布局即可完成常见历史行情分析。

### Phase 2：策略 MCP

实现：

```text
strategy_list
strategy_get_candidates
strategy_explain_signal
```

完成条件：AI 能基于结构化 evidence 解释候选，而不自行重新实现策略规则。

### Phase 3：模拟 MCP

实现：

```text
simulation_run_drawdown_buying
```

后续按真实研究需求增加小粒度模拟 Use Case。

### Phase 4：性能与能力注册

在 Tool 数量增长后，再考虑：

- capability catalog；
- response caching；
- MCP resources；
- 更稳定的数据 revision；
- 大结果流式/分页策略。

## 18. 第一阶段验收标准

1. MCP Tool 中不存在 `data/` 路径硬编码。
2. MCP Tool 中不存在指标/回撤/策略算法。
3. 所有 Tool 经 Application Use Case 调用领域能力。
4. 数据读取通过 Port/Adapter。
5. Capability 不携带具体业务场景、策略名或固定投资阈值。
6. Business Policy 只组合能力，不复制通用算法。
7. Logic 可以使用纯内存输入输出独立测试，不依赖 IO/协议/流程控制。
8. Controller / MCP / CLI / HTTP / Actions 不包含具体业务判断。
9. 第一阶段全部只读。
10. 历史调用有明确 `as_of`，并通过未来数据泄漏测试。
11. 关键结果包含数据质量和来源元数据。
12. Tool 契约有 schema 和错误模型测试。
13. MCP 可以在 Fake Repository 上完成完整测试。
14. 替换 Ledger Adapter 不要求修改 MCP Tool。
15. CLI / Simulator 现有行为不因 MCP 引入而改变。
16. 同一确定性能力在 MCP / CLI / HTTP 场景中只存在一个权威实现。
17. 所有新业务规则先进入 Business Policy / Application，所有通用计算先进入 Capability / Logic，再暴露 MCP。

## 19. 架构决策摘要

### ADR-MCP-001：MCP 作为外层 Adapter

**决定**：MCP 只做协议适配。

**原因**：避免 MCP 成为第二套业务系统，并确保 CLI / HTTP / Actions 可复用相同能力。

### ADR-MCP-002：第一阶段只读

**决定**：禁止数据同步、Git 写入、策略写入与交易写入。

**原因**：先建立可信查询边界，降低 AI 调用的副作用和权限风险。

### ADR-MCP-003：确定性计算由程序完成

**决定**：回撤、收益率、指标、恢复周期、策略匹配和模拟结果必须来自领域代码。

**原因**：提高可重复性、降低 token 消耗和模型数学误差。

### ADR-MCP-004：数据访问经 Port

**决定**：MCP/Application 不依赖 JSON/CSV/SQLite 的具体布局。

**原因**：保护上层契约，使 Repo-as-Data-Ledger 可以继续演进。

### ADR-MCP-005：质量与时间边界是一等公民

**决定**：关键结果必须携带 `as_of` 和质量信息。

**原因**：股票分析中数据时点和口径错误会直接导致错误结论。

### ADR-MCP-006：能力与业务分离

**决定**：通用 Capability 不允许包含具体策略、证券、阈值或投资场景；业务规则通过 Business Policy / Application 组合 Capability。

**原因**：保持能力稳定、可复用，使新增策略主要表现为业务组合变化，而不是复制底层实现。

### ADR-MCP-007：逻辑与控制分离

**决定**：确定性 Logic 不负责 IO、协议和流程编排；Controller 只负责控制流，不允许包含业务规则。

**原因**：让计算可以独立验证，让 MCP / CLI / HTTP / Actions 只成为不同入口，避免控制代码逐渐演化为隐藏业务层。

## 20. 推荐的第一项开发任务

不要先创建 MCP Server。

第一项开发任务应是建立最小垂直切片，并显式验证四个分离边界：

```text
Infrastructure
  LedgerKlineReader
        |
        v
Port
  KlineReader
        |
        v
Capability
  DrawdownCapability
        |
        v
Logic
  DrawdownCalculator
        |
        v
Business / Application
  AnalyzeDrawdownsUseCase
        |
        v
Control / Adapter
  analytics_get_drawdowns MCP Tool
```

实现顺序建议：

1. 先确认/抽取 `DrawdownCalculator`，只接受内存价格序列并返回确定性结果；
2. 建立 `KlineReader` Port 与 `LedgerKlineReader`，隔离数据账本布局；
3. 建立 `DrawdownCapability`，提供稳定通用能力接口，不包含具体策略语义；
4. 建立 `AnalyzeDrawdownsUseCase`，只编排数据读取和能力调用；
5. 为 Logic、Capability、Application、Adapter 分层测试；
6. 最后增加薄的 `analytics_get_drawdowns` MCP Tool。

验收时必须证明：

- 修改 MCP schema 不需要修改回撤算法；
- 修改数据存储不需要修改回撤算法和 MCP Tool；
- 修改回撤算法不需要修改 Controller；
- 新增“跌 8% 加仓”业务不能通过修改 `DrawdownCalculator` 实现；
- CLI / HTTP 如果需要同样的回撤分析，可以直接复用同一 Use Case / Capability。

这个顺序从第一天同时验证 SoC、SRP、能力/业务分离和逻辑/控制分离，而不是先写 MCP Tool 再补架构。
