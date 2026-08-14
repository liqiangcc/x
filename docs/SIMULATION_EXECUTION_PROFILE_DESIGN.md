# Simulation Execution Profile 设计

> 日期：2026-08-12  
> 更新：2026-08-14  
> 状态：Temporal v1 已实现  
> 范围：`simulation_run_drawdown_buying` 的证券执行属性识别、时间轴 Profile 选择、BuyExecutionModel 构造与 Portfolio 执行边界。

## 1. 目标

把以下问题保持为独立变化轴：

1. **证券是什么、在什么有效期具备什么资格**；
2. **某个回测区间内应使用哪些 ExecutionProfile**；
3. **Profile / 特殊 model 如何构造成 BuyExecutionModel**；
4. **Portfolio 在某个日期应该使用哪个执行模型**；
5. **业务为什么产生买入 signal**。

核心原则：

> Security Master 保存事实与证据；Temporal Application 把事实区间映射为 Profile 时间轴；BuyExecutionModelProvider 按日期提供执行模型；Portfolio 只消费执行模型；Business Policy 只决定为什么买。

当前默认自动链路：

```text
KlineReader
   |
   | normalized security + backtest range
   v
ResolveExecutionProfileTimelineUseCase
   |
   +-> SecurityMasterTimelineReader Port
   |      |
   |      v
   |   LedgerSecurityMasterTimelineReader
   |      |
   |      v
   |   Security Master snapshot / effective intervals
   |
   +-> SecurityExecutionProfileResolver Port
          |
          v
Execution profile timeline
   |
   | [{ startDate, endDate, profileId, metadata }]
   v
TimelineBuyExecutionModelProvider
   |
   +-> BuyExecutionModelResolver Port
   |      |
   |      +-> ExecutionProfileCatalog -> ProfiledBuyExecutionModel
   |      +-> exceptional factories
   |
   v
BuyOnlyPortfolioSimulator
```

业务链路独立：

```text
DrawdownBuyingPolicy
   |
   | emits business signals
   v
Application maps signal -> buy order
   |
   v
BuyOnlyPortfolioSimulator
```

## 2. 三种执行选择模式

`SimulateDrawdownBuyingUseCase` 支持三条互斥路径。

### 2.1 自动 Temporal 选择

调用方同时省略：

```text
executionModel
securityMetadata
```

Application：

1. 通过 `KlineReader` 读取规范化回测数据；
2. 取实际 bars 覆盖区间作为 timeline range；
3. 调用 `executionProfileTimelineResolver.execute({ security, startDate, endDate })`；
4. 得到完整、无 gap 的 profile segments；
5. 通过 `buildExecutionModelProvider(...)` 构造 date-aware provider；
6. 把 provider 注入 Portfolio；
7. Portfolio 对每个订单按日期选择 BuyExecutionModel。

返回：

```text
config.executionModel
  单一 profile 区间 -> profile id
  多 profile 区间   -> null

config.executionModelSelection
  security_metadata_timeline

meta.executionSelection
  mode: security_metadata_timeline
  profileId: string | null
  securityMetadataSource: timeline
  timeline[]
```

这里 `profileId=null` 不表示未知，而表示本次回测区间包含多个 Profile；权威信息在 `timeline[]`。

### 2.2 显式 request metadata

调用方提供：

```text
securityMetadata: {
  instrumentType,
  intradayRoundTripEligible
}
```

Application 直接通过 `SecurityExecutionProfileResolver` 得到单一 profile，然后通过 `BuyExecutionModelResolver` 构造静态模型。

该路径用于调用方已经掌握可审计分类事实的场景，不读取 Security Master timeline。

返回模式：

```text
mode: security_metadata
securityMetadataSource: request
```

### 2.3 显式研究 override

调用方提供：

```text
executionModel = legacy_a_share
executionModel = domestic_stock_etf
executionModel = t0_etf
executionModel = frictionless
```

Application 跳过证券分类与 timeline resolution，直接使用 `BuyExecutionModelResolver`。

该能力用于受控模型比较，不代表系统声明证券真实类别。

返回模式：

```text
mode: explicit_override
securityMetadataSource: null
```

MCP schema 不给 `executionModel` 设置默认值，避免协议层抢先覆盖 Application 的自动选择语义。

## 3. Temporal Security Classification

### 3.1 SecurityMasterTimelineReader Port

`src/ports/market/security_master_timeline_reader.js` 定义窄能力：

```text
readTimeline(security, { startDate, endDate })
  -> {
       security,
       startDate,
       endDate,
       segments[],
       gaps[],
       source
     }
```

它与 point-in-time 的 `SecurityMasterReader.readRecord()` 是两个独立 capability：

- point lookup 回答“某一天的有效事实是什么”；
- timeline lookup 回答“一个区间内事实如何变化、哪里没有覆盖”。

不得为了 temporal simulation 把 `readRecord()` 扩成复杂多态接口。

### 3.2 LedgerSecurityMasterTimelineReader

`src/adapters/ledger/ledger_security_master_timeline_reader.js`：

- 依赖 `SecurityMasterSnapshotReader` capability；
- 保留 Security Master 已定义的 priority / effective window 语义；
- 根据 `effectiveFrom/effectiveTo` 生成变更边界；
- 输出互不重叠的 `segments[]` 与显式 `gaps[]`；
- 相邻且由同一记录覆盖的区间自动合并；
- 不选择 execution profile；
- 不构造 BuyExecutionModel；
- 不知道 MCP 或 Business Policy。

时间窗口按 Security Master 的闭区间事实解释：

```text
2026-01-01 .. 2026-06-30
2026-07-01 .. null
```

在 2026-07-01 发生事实切换，不产生一天重叠。

### 3.3 ResolveExecutionProfileTimelineUseCase

`src/application/simulation/resolve_execution_profile_timeline.js` 负责控制/编排：

```text
Security Master fact segments
    |
    | project execution metadata
    v
SecurityExecutionProfileResolver.resolve(...)
    |
    v
Execution profile segments
```

它必须 fail closed：

- Reader 返回非对象 -> error；
- `gaps[]` 非空 -> error；
- 没有 segment -> error；
- segment 不是从 requested start 连续覆盖到 requested end -> error；
- metadata 无法映射到 profile -> resolver error。

Application 自己再次验证连续覆盖，不能完全相信 Adapter 声称 `gaps=[]`。

## 4. BuyExecutionModelProvider

### 4.1 Port

`src/ports/simulation/buy_execution_model_provider.js` 定义：

```text
resolveForDate({ date }) -> BuyExecutionModel
```

Provider 只回答“这个日期使用哪个已经定义好的执行模型”。它不读取 Security Master，不解释证券类型，不产生业务 signal。

### 4.2 TimelineBuyExecutionModelProvider

`src/simulation/execution/timeline_buy_execution_model_provider.js`：

1. 验证 timeline segments 非空、按日期严格排序且不重叠；
2. 将 `profileId` 通过公共 `BuyExecutionModelResolver Port` 构造为模型；
3. 按 `profileId` 缓存模型实例，避免每个订单重复构造；
4. 请求日期不被 timeline 覆盖时 fail closed；
5. 不直接 import concrete A-share / ETF model。

Provider 的存在使 Portfolio 不需要知道 Security Master、instrument type 或 Profile Catalog。

## 5. Portfolio 边界

`BuyOnlyPortfolioSimulator` 接受且只接受以下二选一：

```text
executionModel
executionModelProvider
```

两者同时存在或同时缺失都报错。

静态路径：

```text
Portfolio -> injected BuyExecutionModel
```

Temporal 路径：

```text
Portfolio
   |
   | order.date
   v
BuyExecutionModelProvider.resolveForDate(...)
   |
   v
BuyExecutionModel.executeBuy(...)
```

Portfolio 只负责：

- 账户结算；
- 订单循环；
- 持仓与资金聚合；
- 汇总实际使用过的 execution model 描述。

Portfolio 不得：

- 查询 Security Master；
- 根据证券代码/名称判断类别；
- 映射 metadata -> profile；
- import ExecutionProfileCatalog；
- 构造 concrete execution model。

## 6. SecurityExecutionProfileResolver

`src/ports/simulation/security_execution_profile_resolver.js` 定义：

```text
resolve({ security, metadata }) -> profileId
```

当前纯映射：

```text
a_share
  -> legacy_a_share

etf + intradayRoundTripEligible=false
  -> domestic_stock_etf

etf + intradayRoundTripEligible=true
  -> t0_etf
```

Fail-closed：

- ETF 必须显式给出 T+0 eligibility；
- A 股不能声明 `intradayRoundTripEligible=true`；
- 不根据证券代码前缀、名称、市场号猜测 ETF/T+0；
- resolver 不访问文件、网络、数据库；
- resolver 不知道费用、滑点、成交机制；
- resolver 不自动返回 `frictionless`。

## 7. ExecutionProfile 与执行实现

### 7.1 ExecutionProfile

Profile 是纯市场执行假设：

```text
ExecutionProfile
  id
  assetClass
  kind
  ruleApproximation
  settlement.sharesAvailable
  lotRules.buyLotSize
  priceRules.tickSize / slippageRate?
  feeRules
  restrictionRules
  qualityIssues[]
```

当前 Profile：

```text
legacy_a_share
  buyLotSize: 100
  tickSize: 0.01
  sharesAvailable: next_trading_day

domestic_stock_etf
  buyLotSize: 100
  tickSize: 0.001
  sharesAvailable: next_trading_day
  stampDutyRate: 0

t0_etf
  buyLotSize: 100
  tickSize: 0.001
  sharesAvailable: same_day
  stampDutyRate: 0
```

`t0_etf` 表示“已确认具备同日回转资格的 ETF”，不是“所有 ETF”。

### 7.2 ProfiledBuyExecutionModel

`ProfiledBuyExecutionModel` 是 profile-backed 买入执行的唯一通用流程：

1. 找到 signal 后的下一交易 bar；
2. 应用市场限制；
3. 应用滑点；
4. 按 lot 计算数量；
5. 计算 fill / fee；
6. 根据 settlement 计算可用日期；
7. 返回统一 execution metadata。

不得新增：

```text
src/simulation/execution/t0_etf_buy_execution_model.js
```

普通市场差异优先通过 Profile 数据表达，而不是复制执行类。

### 7.3 BuyExecutionModelResolver

公共 resolver：

```text
profile/model id
   |
   +-> profile exists -> ProfiledBuyExecutionModel(profile)
   |
   +-> exceptional factory exists -> exceptional model
```

`frictionless` 保持特殊研究模型，不进入 Security Master，也不由证券分类 resolver 自动选择。

## 8. 关注点分离

允许：

```text
Application -> KlineReader Port
Application -> SecurityExecutionProfileResolver Port
Application -> temporal resolver abstraction
Application -> BuyExecutionModelResolver Port
Portfolio   -> BuyExecutionModel Port
Portfolio   -> BuyExecutionModelProvider Port

Temporal Resolver Application -> SecurityMasterTimelineReader Port
Temporal Resolver Application -> SecurityExecutionProfileResolver Port

LedgerSecurityMasterTimelineReader -> SecurityMasterSnapshotReader capability
TimelineBuyExecutionModelProvider -> BuyExecutionModelResolver Port

Composition Root -> concrete Ledger timeline reader
Composition Root -> temporal resolver use case
Composition Root -> concrete timeline provider builder
Composition Root -> concrete resolver factories
```

禁止：

```text
Business -> Security Master / Profile / ExecutionModel
MCP Tool -> Security Master / Ledger / concrete resolver
Application -> filesystem / manifest / concrete Ledger reader
Security Master Adapter -> execution profile ids / ExecutionModel
SecurityExecutionProfileResolver -> storage / network / MCP / execution mechanics
Portfolio -> Security Master / classification resolver / Profile Catalog
TimelineBuyExecutionModelProvider -> Security Master / MCP / Business Policy
ExecutionProfileCatalog -> Business Policy
```

## 9. 单一权威实现

当前职责唯一归属：

```text
security identity / eligibility validation -> security_execution_metadata Logic
security fact schema / effective period     -> SecurityMasterRecord Logic
repository point facts                      -> LedgerSecurityMasterReader
repository temporal facts                   -> LedgerSecurityMasterTimelineReader
fact interval -> profile interval           -> ResolveExecutionProfileTimelineUseCase
security facts -> profile id                -> SecurityExecutionProfileResolver
market assumptions                          -> ExecutionProfileCatalog
profile-backed execution flow               -> ProfiledBuyExecutionModel
model construction                          -> BuyExecutionModelResolver
model selection by date                     -> TimelineBuyExecutionModelProvider
business trigger                            -> DrawdownBuyingPolicy
account / order orchestration               -> BuyOnlyPortfolioSimulator
protocol                                    -> MCP Adapter
```

## 10. Temporal v1 的明确语义与剩余边界

### 10.1 已解决

Temporal v1 已经解决：

- 不再拿回测结束日的单一证券事实覆盖整个历史区间；
- Security Master 有效期变化能形成多个 Profile segment；
- 未覆盖日期 fail closed；
- Portfolio 可以在同一次模拟中使用多个执行模型；
- explicit override 与 request metadata 仍保持独立、可控；
- MCP 不拥有 temporal classification 逻辑。

### 10.2 当前选择日期：signal / order date

当前 Portfolio 的实现语义是：

```text
selectedExecutionModel = provider.resolveForDate({ date: order.date })
selectedExecutionModel.executeBuy({ signalDate: order.date, ... })
```

因此 **Temporal v1 按 signal/order date 选择 Profile**。

而 `ProfiledBuyExecutionModel` 当前通常在 signal 后的下一交易 bar 成交。这意味着若 Profile 恰好在 signal 日与实际 execution date 之间发生变化，v1 会沿用 signal 日的 Profile。

这不是隐藏行为，必须作为下一阶段单独评审的时间语义。

### 10.3 下一阶段建议：execution-date rule selection

下一步不应在 Portfolio 中直接复制“下一交易日开盘”的算法来猜 execution date，因为 fill timing 属于执行机制。

优先设计一个明确的执行日期解析边界，例如：

```text
ExecutionSchedule / ExecutionDateResolver
  resolveExecutionDate({ bars, signalDate, orderType? }) -> date | null
```

或者让 date-aware provider 接收足以确定 rule-effective date 的执行上下文，而不是只接收 `order.date`。

目标是最终保证：

> 证券资格、费用、settlement、限制等市场规则，以真正发生执行行为的日期为准，同时不把成交算法复制到 Portfolio、Application 或 Adapter。

在该设计完成前，不应悄悄把 `resolveForDate(order.date)` 改成另一个日期，也不应让 Security Master 知道成交时机。

## 11. Architecture Fitness / 验收

持续保证：

- `BuyExecutionModelProvider` 是正式 Port；
- Portfolio 不构造 concrete model；
- automatic temporal path 覆盖完整区间，否则 fail closed；
- Timeline Adapter 不选择 Profile；
- Temporal Resolver 不构造 ExecutionModel；
- Timeline Provider 不读取 Security Master；
- MCP Composition Root 才负责 concrete wiring；
- request metadata / explicit override 不被 temporal path 抢占；
- `t0_etf` 仍是 profile-only extension；
- 真实 stdio MCP E2E 可以走默认 temporal composition。

核心测试包括：

```text
tests/security-master-temporal.test.js
tests/simulation-execution-boundary.test.js
tests/simulation-security-execution-profile-resolver.test.js
tests/mcp-composition-root.test.js
tests/mcp-simulation-stdio-e2e.test.js
```

## 12. 当前结论

当前结构已经从：

```text
security -> one static profile -> one execution model
```

演进为：

```text
security facts over time
   -> profile timeline
   -> date-aware BuyExecutionModelProvider
   -> Portfolio
```

同时仍保持：

```text
Business Policy != security classification
Security Master != execution mechanics
Profile selection != model construction
Model construction != model use
MCP protocol != business/application rules
```

Temporal v1 已实现并接入 MCP。下一项架构问题是“**Profile 应按 signal date 还是 actual execution date 生效**”，需要在不复制 execution scheduling 逻辑的前提下解决。