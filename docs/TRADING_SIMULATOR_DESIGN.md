# 历史交易模拟器设计

> 日期：2026-07-12
> 状态：Draft
> 目标：基于仓库已有的股票池、历史日线和信号能力，建设一个配置驱动、可回放、可扩展的 A 股交易练习与策略验证平台。

## 1. 背景

仓库当前已经具备以下数据和能力：

- `data/pool/<YYYYMMDD>/` 保存每日股票池快照。
- `data/universe/<YYYYMMDD>/` 保存当前全市场快照；模拟器还需要补充按有效日期查询的历史证券主数据。
- `data/kline/daily/` 和 `data/kline/yearly/` 保存历史 K 线。
- `src/signals/` 提供特征、基础能力、具体信号、评分和解释证据。
- `docs/SIGNALS_DESIGN.md` 已定义“基础能力与具体信号分离”的信号架构。

本设计在这些能力之上增加历史市场回放、选股快照、人工决策、订单撮合、账户持仓和复盘能力。系统首先服务于手动交易练习，同时保证同一套核心机制可以用于自动策略和批量回测。

## 2. 目标与非目标

### 2.1 目标

- 支持按历史交易日推进，任何组件不能读取模拟时点之后的数据。
- 支持从模拟日期当时有效的沪深京全 A 股集合和信号系统生成候选股票，包括后来退市的股票。
- 支持人工查看候选、K 线和证据后提交订单。
- 支持自动策略通过同一交易接口提交订单。
- 模拟 A 股基础交易约束，包括 T+1、整手、停牌、涨跌停和费用。
- 通过配置选择数据源、选股流水线、撮合模型、费用模型、风控和运行模式。
- 候选池默认隐藏股票名称和真实代码，避免既有认知干扰交易判断。
- 保留完整事件、候选快照、订单、成交和账户快照，保证可解释、可审计和可重放。
- Web 界面采用响应式布局，手机端支持候选浏览、图表、下单、完成决策和推进会话。
- 核心领域逻辑不依赖 Web、文件路径、数据库或具体信号实现。

### 2.2 非目标

- 第一阶段不实现实盘交易接口。
- 第一阶段不实现分钟或 Tick 级撮合。
- 第一阶段不追求逐笔成交级精度。
- 第一阶段不支持融资融券、期权和期货。
- 第一阶段不提供在 JSON 配置中执行任意表达式或用户代码的能力。
- 第一阶段不引入消息队列、微服务或复杂插件沙箱。

## 3. 设计原则

### 3.1 核心能力与可变机制分离

核心能力描述稳定事实和状态转换：

- 市场时钟。
- 行情读取边界。
- 订单、成交、持仓和账户。
- 会话生命周期。
- 事件与快照。

可变机制描述“如何执行”：

- 如何选择股票。
- 如何排序候选。
- 如何决定买卖。
- 如何计算下单数量。
- 如何校验订单。
- 如何撮合成交。
- 如何计算费用和滑点。

核心层不得依赖任何具体机制；机制通过稳定接口接入核心。

### 3.2 配置负责装配，代码负责规则

配置负责选择组件、提供参数和组合执行流程。业务规则、算法、不变量和状态变更保留在代码中。

允许：

```json
{
  "type": "minimum_listing_days",
  "days": 60
}
```

不允许：

```json
{
  "expression": "eval(userCode)"
}
```

### 3.3 人工交易与自动策略等价

人工操作和自动策略最终都必须产生相同的 `OrderIntent`，经过相同的风控、订单、撮合、费用和账户更新流程。UI 不得直接修改账户或持仓。

### 3.4 确定性优先

相同的数据版本、配置、起始状态和操作序列必须产生相同结果。所有可能影响结果的参数都要进入会话清单，包括数据内容摘要、点时复权因子、撮合模型、费用、随机种子和组件版本。会话启动后冻结数据版本。

### 3.5 时间边界优先

禁止未来函数是第一约束。所有数据读取必须携带 `asOfDate`，仓储适配器不得向调用方返回该日期之后的数据。

## 4. 总体架构

```text
配置文件
   |
   v
SessionBuilder ---- ComponentRegistry
   |
   +--> 数据端口 <---- 本地 JSON / 后续数据库
   +--> 选股流水线 <---- 现有 src/signals
   +--> 决策策略 <---- 人工 UI / 自动策略
   +--> 风控、撮合、费用、市场规则
   |
   v
SimulationSession
   |
   +--> Domain Events
   +--> Session Snapshots
   +--> Orders / Fills / Portfolio
   |
   +--> CLI / HTTP API / Web UI / Batch Runner
```

推荐分层：

```text
src/simulator/
  core/           稳定领域对象和状态转换
  mechanisms/     撮合、费用、市场规则和风控机制
  selection/      候选集合流水线及信号适配
  policies/       人工或自动决策、仓位管理
  application/    用例编排
  ports/          数据和持久化接口
  adapters/       文件、数据库、HTTP 等实现
  config/         配置校验、注册和装配
```

依赖方向：

```text
adapters --> application --> core
                 |            ^
                 +--> mechanisms
                 +--> selection
                 +--> policies
```

`core` 不得反向依赖其他层。

## 5. 核心领域模型

### 5.1 MarketBar 与价格视图

标准化日线同时保留真实成交价格和点时前复权价格：

```js
{
  code: "600519",
  market: 1,
  market: 1,
  date: "2026-07-01",
  raw: {
    open: 1412.5,
    high: 1430.0,
    low: 1401.2,
    close: 1422.8,
    prevClose: 1408.0
  },
  adjusted: {
    type: "forward_point_in_time",
    factorVersion: "factor-20260701",
    open: 1412.5,
    high: 1430.0,
    low: 1401.2,
    close: 1422.8
  },
  volume: 123456,
  amount: 175000000,
  suspended: false
}
```

原始 K 线格式由数据适配器解析，核心层只接收标准化对象。信号和图表使用 `adjusted`；成交、资金、费用、涨跌停和持仓成本只使用 `raw`。禁止用现有可能出现负价格的前复权行情计算成交金额。

### 5.2 Candidate

候选池对客户端输出的匿名 DTO：

```js
{
  candidateId: "candidate-001",
  alias: "候选A",
  date: "2026-07-01",
  score: 82.5,
  rank: 1,
  pools: [],
  signals: ["year_decline_close_breakout"],
  reasons: ["连续4个年度下跌，本年度首次收盘突破去年最高价"],
  evidence: {},
  qualityIssues: []
}
```

候选对象只表达“为什么值得关注”，不得直接触发下单。匿名会话的外部 DTO 不得包含真实 `code`、`name`、`market` 或可反推身份的字段；真实身份只保存在服务端内部映射中。

### 5.3 OrderIntent

人工或自动策略产生的交易意图：

```js
{
  source: "manual",
  candidateId: "candidate-001",
  side: "buy",
  orderType: "market",
  quantity: 100,
  limitPrice: null,
  reason: "候选排名第一，突破后回踩",
  candidateSnapshotId: "snapshot-20260701"
}
```

`source` 可为 `manual` 或具体策略 ID。客户端只提交 `candidateId`，由服务端解析真实 `code + market`。

### 5.4 Order

订单是核心层管理的实体，至少包含：

```js
{
  id: "order-001",
  sessionId: "session-001",
  submittedAtDate: "2026-07-01",
  eligibleFillDate: "2026-07-02",
  code: "600519",
  market: 1,
  side: "buy",
  orderType: "market",
  quantity: 100,
  remainingQuantity: 100,
  status: "accepted",
  rejectionReason: null
}
```

订单状态：

```text
submitted
accepted
rejected
filled
partially_filled
cancelled
expired
```

第一阶段可以不产生部分成交，但状态枚举保留扩展空间。

### 5.5 Fill

成交是账户变化的唯一输入：

```js
{
  id: "fill-001",
  orderId: "order-001",
  date: "2026-07-02",
  code: "600519",
  market: 1,
  side: "buy",
  quantity: 100,
  price: 1425.0,
  grossAmount: 142500,
  commission: 42.75,
  stampDuty: 0,
  transferFee: 1.43,
  totalFee: 44.18
}
```

### 5.6 Account 与 Position

账户保存现金、冻结资金、持仓和权益。持仓至少区分总数量和当日可卖数量：

```js
{
  code: "600519",
  market: 1,
  totalQuantity: 100,
  availableQuantity: 0,
  todayBuyQuantity: 100,
  averageCost: 1425.4418,
  marketValue: 142280,
  unrealizedPnl: -264.18
}
```

`Account` 只能通过 `applyFill(fill)` 等领域方法变化，外部组件不能直接写字段。

### 5.7 SimulationSession

会话聚合一次完整练习或回测：

- 配置快照。
- 数据版本和日期范围。
- 当前市场日期。
- 账户状态。
- 当前候选快照。
- 待处理订单。
- 事件序列号。
- 会话状态。

会话状态：

```text
created
running
waiting_for_decision
completed
cancelled
failed
```

## 6. 时间模型与信息隔离

### 6.1 默认日线时序

第一阶段采用“收盘后决策、下一交易日开盘成交”：

```text
D 日收盘
  -> D 日行情变为可见
  -> 使用不晚于 D 日的数据生成候选
  -> 会话进入 waiting_for_decision 并暂停推进
  -> 人工或自动策略可提交、修改、取消多笔订单
  -> completeDecision 锁定订单并冻结预计资金或可卖股份
D+1 日开盘
  -> 检查停牌和涨跌停可成交性
  -> 使用 D+1 开盘价和滑点撮合
  -> 费用计算
  -> 账户更新
D+1 日收盘
  -> 生成新的候选和账户快照
```

默认禁止使用 D 日收盘信号并按 D 日收盘价成交。

### 6.2 数据访问契约

所有市场数据端口必须显式接收时间边界，并在返回前完成截断：

```js
marketData.getBar({ code, market, date });
marketData.getHistory({ code, market, endDate: asOfDate, limit: 120 });
poolData.getSnapshot({ pool, date: asOfDate });
```

禁止提供没有日期边界的 `getAllHistory(symbol)` 给选股和策略组件。`dailyRows` 只能包含 `date <= asOfDate` 的记录；已完成年线只能包含当前自然年以前的数据；当前年线必须由截断后的日线实时聚合。

### 6.3 复权约束

精确模式采用双价格体系：展示、信号和 BOLL 使用严格点时前复权价格；模拟成交、资金、费用和涨跌停使用不复权真实价格。同一信号内的今日价格和历史基准必须使用同一版本的点时前复权因子。为优先交付可交易系统，MVP 允许 `legacy_approximate` 模式复用现有前复权 K 线成交，但必须在会话、界面和报告持续标记近似性，并拒绝非有限或非正数价格。缺少的历史数据能力列为 TODO，不阻止 MVP。

## 7. 选股集合设计

### 7.1 选股流水线

```text
UniverseProvider
  -> StockFilter[]
  -> SignalEvaluator
  -> CandidateRanker
  -> CandidateLimiter
  -> CandidateSnapshot
```

各阶段职责：

- `UniverseProvider`：给出当日可评估代码范围。
- `StockFilter`：排除不符合基础条件的股票。
- `SignalEvaluator`：复用 `src/signals/` 计算信号、得分和证据。
- `CandidateRanker`：按配置稳定排序。
- `CandidateLimiter`：限制展示或决策数量。
- `CandidateSnapshot`：保存当时可见的候选结果，供复盘引用。

### 7.2 与现有信号系统的边界

`src/signals/` 继续负责：

- 从只读 `SignalContext` 计算特征和信号。
- 输出 `ok`、`score`、`evidence` 和 `qualityIssues`。
- 保持不读文件、不写报告、不提交订单。

模拟器新增 `SignalSelectionAdapter`，负责：

- 根据会话日期读取股票池和历史 K 线。
- 构建截至 `asOfDate` 的 `SignalContext`。
- 调用已注册信号。
- 聚合为标准 `Candidate`。
- 保存候选快照。

模拟器不得复制现有信号算法。

### 7.3 Universe 示例

可注册的候选范围来源：

- `pool_snapshot`：当日 `zt`、`qs`、`zb` 或其并集。
- `codes_snapshot`：当日 pool 派生的 `codes.json`，仅适合限定范围研究，不能代表全市场。
- `static_symbols`：配置指定代码，主要用于测试。
- `historical_a_share`：模拟日期当时有效的沪深京全 A 股，包括后来退市的股票；默认使用。

必须使用当日历史快照，不得用当前成分股列表回填历史日期。

### 7.4 人工与自动模式

人工模式：

```text
CandidateSnapshot -> UI -> OrderIntent(source=manual)
```

自动模式：

```text
CandidateSnapshot -> TradingPolicy -> PositionSizer -> OrderIntent
```

两种模式从 `OrderIntent` 开始完全共用后续流程。

### 7.5 默认候选策略

首版默认候选策略 ID 为 `year_decline_close_breakout`，业务含义为：

1. 最近 4 个已完成自然年度的收盘价严格逐年下降。
2. 基准价为上一自然年度年线最高价。
3. 当前模拟日的日线收盘价严格大于该基准价。
4. 当前自然年首个交易日至模拟日前一交易日的全部收盘价都小于或等于该基准价。

因此，“今天首次突破”使用收盘价确认：

```text
today.close > previousYear.high
and max(currentYearClosesBeforeToday) <= previousYear.high
```

连续多年下跌默认使用已完成年度的年线收盘价判断：

```text
Y-4.close > Y-3.close > Y-2.close > Y-1.close
```

默认参数为 `downTransitions: 3`，即最近 4 个连续、完整的已完成自然年度形成 3 次严格下降。任何一个自然年度缺失都直接排除。该参数可以在候选池页面调整，但会话开始后配置冻结。

默认策略必须输出以下证据：

```js
{
  completedYears: [
    { year: 2022, close: 21.4 },
    { year: 2023, close: 18.2 },
    { year: 2024, close: 15.6 },
    { year: 2025, close: 12.9 }
  ],
  downTransitions: 3,
  previousYearHigh: 16.8,
  maxCurrentYearCloseBeforeToday: 16.5,
  todayClose: 17.1,
  breakoutMarginPct: 1.79
}
```

该策略应通过已有基础能力组合实现：

- `SEQUENCE_PATTERN` 判断年度收盘价连续下降。
- `VALUE_COMPARE` 判断今日收盘价突破去年最高价。
- `FIRST_CROSS` 的年度范围版本判断本年度此前从未收盘突破。
- `QUALITY_GATE` 判断年度和日线历史是否充足。

现有 `year_breakout` 使用“当日最高价首次突破去年最高价”的定义，不能直接替代本默认策略。为了保持既有日报兼容性，不修改其语义；新增独立复合策略 `year_decline_close_breakout`。

### 7.6 候选池页面

候选池页面既是默认策略的展示页面，也是配置编辑入口。首版至少支持：

- 选择模拟日期，只能查看该日期及以前的数据。
- 默认用“候选A、候选B”等稳定别名展示排名、得分和信号证据，不返回股票名称和真实代码。
- 调整连续下跌年度转换次数。
- 调整突破比较符，默认严格大于。
- 选择候选来源范围，默认使用模拟日期当时有效的沪深京全 A 股。
- 默认排除当日 ST、*ST 和退市整理股票，允许配置开启。
- 增加、移除或启停过滤器和辅助信号。
- 调整排序字段和候选数量上限。
- 将当前配置另存为命名预设。
- 恢复系统默认配置。
- 从候选股票进入交易页面，但进入页面本身不得自动下单。

候选配置变更分成两类：

- 尚未开始的会话：允许修改并重新生成候选。
- 已开始的会话：当前配置不可修改；从当前收盘账户状态克隆子会话，并从下一交易日使用新配置。

每次生成结果必须记录 `selectionConfigHash`，订单引用具体 `candidateSnapshotId`。别名映射只保存在服务端；普通匿名会话主动揭晓时记录 `IdentityRevealed`，随机盲测只能在完成或主动结束后揭晓。

## 8. 机制接口

以下为概念接口，具体命名可在实现阶段调整。

### 8.1 UniverseProvider

```js
class UniverseProvider {
  async resolve(context, params) {
    return [];
  }
}
```

### 8.2 StockFilter

```js
class StockFilter {
  async apply(context, symbols, params) {
    return symbols;
  }
}
```

过滤结果应保留排除原因，便于质量分析和复盘。

### 8.3 CandidateRanker

```js
class CandidateRanker {
  rank(context, candidates, params) {
    return candidates;
  }
}
```

排序必须稳定；分数相同时使用股票代码等确定性字段作为次级排序键。

### 8.4 TradingPolicy

```js
class TradingPolicy {
  decide(context, candidateSnapshot, params) {
    return [];
  }
}
```

人工模式使用 `ManualPolicy`，它不自动生成意图，只把会话置为 `waiting_for_decision`。

### 8.5 PositionSizer

```js
class PositionSizer {
  size(context, decision, params) {
    return {
      quantity: 100
    };
  }
}
```

### 8.6 RiskManager

```js
class RiskManager {
  validate(context, orderIntent, params) {
    return {
      accepted: true,
      reasons: []
    };
  }
}
```

风控分为：

- 交易所规则：不可绕过，例如 T+1 和整手。
- 会话风控：由配置启用，例如最大持仓数和单股仓位上限。

### 8.7 FillModel

```js
class FillModel {
  tryFill(context, order, bar, params) {
    return {
      status: "filled",
      price: bar.open,
      quantity: order.remainingQuantity
    };
  }
}
```

### 8.8 FeeModel

```js
class FeeModel {
  calculate(context, fillDraft, params) {
    return {
      commission: 0,
      stampDuty: 0,
      transferFee: 0,
      totalFee: 0
    };
  }
}
```

费用参数必须按适用日期配置或版本化，避免把当前规则错误应用于全部历史时期。

## 9. 配置与组件注册

### 9.1 会话配置示例

```json
{
  "version": 1,
  "session": {
    "mode": "manual",
    "startDate": "2026-03-02",
    "endDate": "2026-03-31",
    "initialCash": 100000,
    "randomSeed": 20260712
  },
  "data": {
    "marketDataProvider": "local_kline",
    "securityMasterProvider": "historical_security_master",
    "signalPriceView": "forward_point_in_time",
    "executionPriceView": "raw",
    "dataVersion": "sha256:<content-hash>"
  },
  "selection": {
    "universe": {
      "type": "historical_a_share",
      "markets": ["sh", "sz", "bj"],
      "includeLaterDelisted": true
    },
    "filters": [
      {
        "type": "exclude_special_treatment",
        "enabled": true
      },
      {
        "type": "minimum_completed_years",
        "count": 4,
        "consecutive": true
      }
    ],
    "strategy": {
      "type": "year_decline_close_breakout",
      "downTransitions": 3,
      "requireConsecutiveCalendarYears": true,
      "firstBreakoutScope": "current_year",
      "breakoutOperator": "gt"
    },
    "auxiliarySignals": [],
    "ranker": {
      "type": "breakout_margin_ascending"
    },
    "limit": 20
  },
  "execution": {
    "fillModel": {
      "type": "next_open"
    },
    "slippageModel": {
      "type": "percentage",
      "rate": 0.001
    },
    "feeModel": {
      "type": "historical_a_share"
    }
  },
  "marketRules": {
    "type": "historical_a_share_daily",
    "tPlusOne": true,
    "lotSize": 100,
    "enforcePriceLimit": true
  },
  "risk": {
    "defaultEnforcement": "warning",
    "rules": []
  },
  "persistence": {
    "type": "sqlite",
    "export": "json"
  },
  "privacy": {
    "anonymousByDefault": true,
    "blindModeReveal": "session_end"
  }
}
```

### 9.2 配置校验

启动会话前必须完成：

- 结构和类型校验。
- 日期范围校验。
- 组件是否已注册。
- 参数是否符合组件 schema。
- 组件组合是否兼容。
- 数据覆盖范围预检。
- 配置版本迁移或拒绝不支持的版本。

校验失败时不得创建部分可运行会话。

### 9.3 ComponentRegistry

```js
registry.register("universe", "historical_a_share", HistoricalAShareUniverse);
registry.register("filter", "exclude_suspended", ExcludeSuspendedFilter);
registry.register("ranker", "breakout_margin_ascending", BreakoutMarginAscendingRanker);
registry.register("fillModel", "next_open", NextOpenFillModel);
registry.register("feeModel", "historical_a_share", HistoricalAShareFeeModel);
registry.register("marketRules", "historical_a_share_daily", HistoricalAShareDailyRules);
```

新增组件的标准步骤：

1. 实现对应接口。
2. 声明配置 schema 和默认值。
3. 注册组件 ID。
4. 增加契约测试。
5. 在示例配置或文档中说明行为。

应用编排不得通过连续 `if/else` 判断组件类型。

## 10. 会话推进流程

### 10.1 创建会话

```text
读取配置
  -> 校验配置
  -> 解析组件
  -> 预检数据范围
  -> 创建账户
  -> 固化配置和数据清单
  -> 写入 SessionCreated
```

### 10.2 推进一个交易日

```text
确认会话可推进
  -> MarketClock 前进到下一交易日
  -> 处理当日开盘可成交订单
  -> 费用计算并生成 Fill
  -> Account.applyFill
  -> 到达当日收盘
  -> 按 asOfDate 构建候选快照
  -> 账户按收盘价估值
  -> 保存会话快照
  -> 人工模式进入 waiting_for_decision 并返回
  -> 自动模式运行策略并调用 completeDecision
```

### 10.3 提交人工订单

```text
验证会话处于 waiting_for_decision
  -> 验证股票和数量
  -> 保存人工理由及候选快照引用
  -> 运行 MarketRules 和 RiskManager
  -> 接受订单时冻结预计资金或可卖股份
  -> 接受或拒绝订单，可在 completeDecision 前修改或取消
  -> 记录领域事件
```

`completeDecision` 锁定当日全部订单并将会话恢复为 `running`。同一股票允许多笔独立订单，每笔独立保存理由并计算最低佣金。D+1 无法成交的订单当日转为 `expired`，同时释放冻结资产。

## 11. 领域事件

第一阶段使用进程内同步事件分发，并持久化事件记录，不引入外部消息队列。

建议事件：

```text
SessionCreated
SessionStarted
MarketAdvanced
MarketClosed
CandidateSnapshotCreated
DecisionRequested
OrderSubmitted
OrderAccepted
OrderRejected
OrderCancelled
OrderFilled
OrderExpired
PortfolioUpdated
IdentityRevealed
SessionCloned
SessionSnapshotCreated
SessionCompleted
```

标准事件信封：

```js
{
  id: "event-000001",
  sequence: 1,
  type: "OrderFilled",
  sessionId: "session-001",
  marketDate: "2026-07-02",
  recordedAt: "2026-07-12T08:00:00.000Z",
  payload: {}
}
```

`marketDate` 表示模拟时间，`recordedAt` 表示实际操作时间，两者不可混用。

## 12. 持久化设计

第一阶段使用 SQLite 保存会话事务状态和事件，完成或按需导出 JSON 审计包：

```text
runs/simulator/<session_id>/export/
  manifest.json
  config.json
  events.jsonl
  orders.json
  fills.json
  candidates/
    20260302.json
    20260303.json
  snapshots/
    20260302.json
    20260303.json
  report.json
```

要求：

- `config.json` 保存解析默认值后的最终配置。
- `manifest.json` 保存数据路径、版本摘要、运行状态和组件清单。
- SQLite 中的事件表只追加，不原地修改历史事件；账户、订单和冻结资产在同一事务中更新。
- 快照用于快速恢复，事件用于审计。
- 候选快照独立保存，交易理由通过 ID 引用。
- 匿名别名映射不进入会话运行期间的客户端导出；揭晓后才进入最终实名复盘包。
- 所有 JSON 输出必须稳定排序或采用稳定字段顺序，便于 diff。

模拟输出属于运行产物，不得混入 `data/pool` 和 `data/kline` 原始账本。

## 13. 应用用例与外部接口

应用层先定义用例，CLI 和 HTTP 只是适配器：

```text
createSession(config)
startSession(sessionId)
advanceSession(sessionId)
getSessionState(sessionId)
getCandidates(sessionId, date)
submitOrderIntent(sessionId, intent)
updateOrderIntent(sessionId, orderId, intent)
cancelOrder(sessionId, orderId)
completeDecision(sessionId)
cloneSession(sessionId, selectionConfig)
revealIdentity(sessionId)
finishSession(sessionId)
generateReport(sessionId)
```

CLI 可逐步提供：

```bash
bin/x simulator create --config config/simulator/manual.json
bin/x simulator show <session_id>
bin/x simulator next <session_id>
bin/x simulator candidates <session_id>
bin/x simulator buy <session_id> 600519 --quantity 100
bin/x simulator sell <session_id> 600519 --quantity 100
bin/x simulator finish <session_id>
```

服务端采用 Fastify 暴露 REST API，Web UI 调用同一应用用例，不复制业务规则。普通匿名会话只有显式揭晓后才返回真实身份；随机盲测的揭晓接口在会话完成或主动结束前必须拒绝。客户端所有交易操作只传 `candidateId` 或持仓别名。

### 13.1 Web 页面要求

#### 候选池页面

候选池页面负责配置和解释选股结果，使用 React 实现常用表单和带 schema 校验的高级 JSON 编辑器，布局至少包含：

```text
模拟日期 / 配置预设 / 重新计算
  -> 策略参数与过滤条件
  -> 候选列表
  -> 连续下跌年度、去年最高价、昨日收盘、今日收盘等证据
  -> 匿名查看走势 / 进入交易
```

修改候选参数只影响候选生成，不得绕过订单接口修改账户。

#### 交易页面

交易页面首版至少包含：

- 稳定匿名别名、相对日期和候选理由；默认不显示股票名称与真实代码。
- 日线走势图。
- 年线走势图。
- 日线 BOLL 指标，默认参数为 `20` 日和 `2` 倍标准差。
- BOLL 参数调整，包括周期和标准差倍数。
- 日线与年线的独立缩放和可见区间选择。
- 当前价、去年最高价以及首次突破日期的参考线或标记。
- 当前账户、持仓、可用数量和浮动盈亏。
- 买入、卖出、数量和必填交易理由输入。
- 当前订单、历史成交和交易日志。
- 推进到下一交易日的操作。

默认图表组合：

```text
主图：日线蜡烛 + BOLL 上轨/中轨/下轨 + 去年最高价参考线
副图：日线成交量
年线视图：年度 OHLC 蜡烛或年线走势 + 已完成年度连续下跌标记
```

图表必须遵守会话时间边界：

- 日线最多展示到当前模拟日。
- 当前年度年线只能使用截至当前模拟日聚合的部分年度数据，并明确标注“未完成”。
- 已完成年度数据可以展示完整年线。
- BOLL 只能使用当前模拟日及以前的日线计算。
- UI 和接口均不得返回未来数据，不能只依靠前端隐藏。

BOLL 属于展示指标和可选信号能力，不属于账户或撮合核心。应抽出返回完整上、中、下轨序列的纯指标函数；图表使用完整序列，`WINDOW_BAND` 使用指定日期的结果，避免候选页和交易页出现两套公式。默认口径为 20 日收盘价、2 倍总体标准差，前 19 个点返回空值。

#### 响应式与手机端

界面采用移动优先的响应式布局，手机端必须支持完整浏览与交易：

- 桌面端并排展示候选配置、候选列表和证据；交易页同时展示日线主图和年线副视图。
- 手机端使用单列候选卡片，配置表单和高级 JSON 放入抽屉或折叠面板。
- 手机端日线与年线使用标签切换；日线保留 BOLL 和成交量。
- ECharts 图表支持触摸缩放、拖动、十字光标和横屏。
- 买入、卖出、完成决策和推进会话使用底部固定操作区。
- 下单确认展示数量、预计金额、费用、冻结资产和必填理由。
- 核心触摸目标不小于 44px；窄屏表格转为卡片，核心操作不得依赖横向滚动。

## 14. A 股第一阶段规则

第一阶段至少实现：

- 买入数量为 100 股整数倍。
- 卖出允许处理最终不足一手的零股持仓，具体规则由 `AShareDailyRules` 明确。
- 当日买入数量次一交易日才可卖出。
- 停牌日订单不可成交。
- 涨停价开盘的买单、跌停价开盘的卖单一律保守拒绝成交。
- 订单默认使用 0.1% 双向不利滑点，价格按最小报价单位向不利方向取整，且不得超出真实高低价和涨跌停范围。
- 无法成交的次日开盘订单在当日失效，不延续至后续交易日。
- 佣金双边计算并支持最低佣金。
- 印花税仅卖出收取，税率按配置版本确定。
- 资金不足或可卖数量不足时拒绝订单。
- 历史 ST、板块、涨跌停和费用规则按适用日期版本化。

仅凭日线无法确定盘中成交先后时，应采用明确且偏保守的模型，并在成交记录中保存模型 ID。

## 15. 复盘与绩效

系统除收益指标外，还应服务于交易练习复盘。

基础绩效：

- 总收益率和年化收益率。
- 最大回撤。
- 波动率、Sharpe、Sortino。
- 胜率、盈亏比、Profit Factor。
- 持仓时间和换手率。
- 费用和滑点占比。

练习复盘：

- 下单时看到的候选排名、信号和证据。
- 人工填写的交易理由。
- 计划价格与实际成交价格。
- 是否违反会话风控。
- 候选未交易、交易后提前卖出等行为统计。
- 按信号、股票池、持仓周期和市场阶段分组的结果。
- 默认以沪深 300 为收益基准，并允许切换或关闭。
- 普通匿名会话记录主动揭晓时间；随机盲测只在完成或主动结束后揭晓真实股票与日期。

报告层只读取事件和快照，不反向修改会话。

## 16. 错误与数据质量

错误分为三类：

1. `configuration_error`：配置或组件装配错误，会话不得启动。
2. `data_quality_error`：缺失行情、股票池或历史窗口不足，根据配置跳过股票或暂停会话。
3. `domain_rejection`：资金不足、T+1、涨跌停等正常业务拒绝，不视为系统故障。

候选选择必须保留质量问题；不能把“数据不足”当成“信号未命中”。

会话配置应支持质量策略：

```json
{
  "quality": {
    "missingPool": "fail_session",
    "missingBar": "skip_symbol",
    "insufficientHistory": "exclude_candidate"
  }
}
```

## 17. 测试策略

### 17.1 核心单元测试

- 成交后现金和持仓守恒。
- 买入费用进入持仓成本。
- 卖出费用和印花税正确扣除。
- T+1 可卖数量跨交易日释放。
- 资金和持仓不能为负数。
- 接受、取消和失效订单时资金与股份冻结、释放正确。
- 同股多笔订单保持独立并分别计算最低佣金。
- 订单状态转换合法。
- 相同输入产生相同结果。

### 17.2 机制契约测试

每种注册组件必须通过统一契约：

- 不修改只读上下文。
- 缺少参数时给出明确错误。
- 输出符合标准结构。
- 相同输入输出稳定。
- 不读取 `asOfDate` 之后的数据。

### 17.3 时序测试

构造少量固定日线，验证：

- D 日信号不能按 D 日收盘成交。
- D+1 停牌时订单不成交。
- D+1 一字涨停时买单不成交。
- 未推进到 D+1 时账户不提前变化。
- 候选上下文不包含 D+1 数据。
- 本年度任一较早交易日收盘已经高于去年最高价时，今日不得再次命中“首次突破”。
- 今日最高价突破但收盘价未突破时，不得命中默认候选策略。
- 最近 4 个自然年度不连续、缺失或下降次数不足时，不得命中默认候选策略。
- 当前年度聚合和 BOLL 计算均不包含模拟日之后的数据。
- 模拟日之后发生的公司行为不得改变点时前复权图表和信号结果。
- 涨停开盘买单、跌停开盘卖单不成交，订单当日失效并释放冻结资产。
- 匿名 API、图表、账户、持仓、订单和成交响应不得包含真实名称、代码或可反推身份的字段。
- 普通匿名会话揭晓后写入审计事件；随机盲测结束前拒绝揭晓。

### 17.4 端到端测试

使用固定股票、固定日期和小规模夹具完成：

```text
创建会话
  -> 生成候选
  -> 人工买入
  -> 推进并成交
  -> T+1 后卖出
  -> 生成报告
```

端到端测试不得依赖网络。

## 18. 安全与可维护性

- 配置文件不得加载任意 JavaScript 模块路径。
- 组件只能从显式注册表选择。
- UI 输入必须在应用层重新校验，不能信任前端。
- SQLite 中的事件追加、订单、冻结资产和账户快照使用同一事务提交；JSON 导出采用临时文件加原子重命名。
- 会话推进命令应使用乐观版本号或锁，避免重复推进。
- 核心计算尽量使用整数股数和明确的金额精度策略，避免浮点累计误差。
- 日志中不写入密钥或外部数据源凭据。

## 19. 建议实施阶段

### Phase 1：无 UI 的确定性内核

- 适配现有 `data/universe`、`data/pool` 和 `data/kline`，建立带内容摘要的 `legacy_approximate` 数据模式。
- 标准化 `MarketBar`。
- `MarketClock`、`Order`、`Fill`、`Account` 和 `Session`。
- 下一交易日开盘撮合。
- 基础 A 股规则和费用。
- 使用静态代码列表的 CLI 端到端演示。

验收：固定夹具可以稳定完成买入、推进、卖出和账户结算。

### Phase 2：接入选股与信号

- `HistoricalAShareUniverse`，覆盖沪深京和后来退市股票。
- `SignalSelectionAdapter`。
- 默认 `year_decline_close_breakout` 复合候选策略。
- 候选排序和快照。
- 手动订单引用候选证据。

验收：可在历史日期仅使用当时数据生成可解释候选集合。

### Phase 3：手动训练界面

- 会话创建和恢复。
- 可调整参数和保存预设的候选池页面。
- 日线、年线、日线 BOLL、账户、订单和交易日志页面。
- 默认匿名候选、普通会话揭晓和随机盲测。
- React + ECharts 响应式布局及手机端完整交易。
- 下一日推进和买卖操作。
- 隐藏未来日期及价格。

验收：用户可以完成一段历史区间的人工交易练习并生成复盘报告。

### Phase 4：历史数据准确性 TODO

- 补齐历史沪深京 Universe 和后来退市股票。
- 增加不复权真实行情、公司行为和点时复权。
- 增加历史 ST、板块、涨跌停、费用和沪深 300 基准。
- 完成 `historical_accurate` 数据门禁和全历史回填。

验收：精确模式可以替换 MVP 数据适配器而不修改交易核心和 UI 用例。

### Phase 5：自动策略与批量回测

- `TradingPolicy` 和 `PositionSizer` 注册机制。
- 多配置批量运行。
- 参数对比和基准收益。

验收：自动策略与人工交易使用相同的订单、撮合和账户代码。

## 20. 首版验收标准

- 能从配置创建和恢复模拟会话。
- 能按历史交易日逐日推进，且测试证明不存在未来数据泄漏。
- 能从现有 Universe 或本地 K 线交集生成“连续 4 个已完成年度下跌、本年度今日收盘首次突破去年最高价”的默认候选快照，并展示数据覆盖范围。
- 能在候选池页面调整策略参数，并保留配置版本和历史候选快照。
- 能手动买卖并按下一交易日开盘模型成交。
- 能正确处理整手、T+1、资金、持仓、停牌和基础涨跌停约束。
- 交易页面能查看截至模拟日的年线、日线和日线 BOLL。
- 候选、图表、持仓和订单默认匿名，服务端响应不泄露真实身份。
- 桌面和手机端都能完成候选浏览、图表操作、下单、完成决策和推进会话。
- 能保存配置、事件、候选、订单、成交和每日账户快照。
- 能生成基础绩效及带交易理由的复盘报告。
- 新增选股器、排序器或撮合模型时不需要修改核心领域代码。

## 21. 已确认默认值

- 市场范围：模拟日当时有效的沪深京全 A 股，包括后来退市股票。
- 历史范围：各数据源全部可得历史，数据账本先于正式模拟器界面。
- 价格：MVP 使用带显著近似标识的现有前复权价格完成交易闭环；后续精确模式使用点时前复权信号和不复权真实成交。
- 候选：连续 4 个完整自然年度下跌，本年度今日收盘首次突破去年最高价。
- 匿名：候选池默认隐藏名称和代码；随机盲测结束前不得揭晓。
- 订单：仅次日开盘单，默认 0.1% 不利滑点，未成交当日失效。
- 账户：默认 10 万元，不设置默认组合仓位阈值。
- 技术栈：本机单用户，Fastify + SQLite + JSON 导出，React + Apache ECharts。
- 界面：移动优先响应式布局，手机端支持完整交易。
