# Historical Execution Rules 设计

> 日期：2026-08-14  
> 状态：设计完成，尚未接入默认模拟链路  
> 范围：历史回测中随日期变化的交易执行规则版本化；不改变证券分类、Business Policy 或 MCP 协议。

## 1. 背景

Temporal Execution Profile 已经解决了第一条时间轴：

```text
Security Master facts
        |
        | effectiveFrom / effectiveTo
        v
SecurityExecutionProfileResolver
        |
        v
logical execution profile id
        |
        v
TimelineBuyExecutionModelProvider
```

因此当一只证券在回测区间内从一种执行资格切换到另一种执行资格时，系统可以在真实候选 execution date 使用正确的**逻辑 Profile family**。

但当前 `ExecutionProfileCatalog` 仍然只有一组“当前近似规则”：

```text
legacy_a_share
  -> current lot / tick / fee / restriction assumptions

domestic_stock_etf
  -> current lot / tick / fee / settlement assumptions

t0_etf
  -> current lot / tick / fee / settlement assumptions
```

这意味着另一个独立问题仍未解决：

> 同一个 logical profile id 的执行规则本身，在历史上也可能发生变化。

例如：

- 税费规则变化；
- 最小交易单位变化；
- 最小价格变动单位变化；
- settlement 规则变化；
- 涨跌停 / 停牌等执行限制变化；
- 某些市场规则从一个生效日切换到另一个版本。

如果把 2026 年的当前规则无条件用于 2010 年回测，即使证券分类时间轴完全正确，执行结果仍可能产生 temporal leakage。

## 2. 两条时间轴必须分离

这是本设计最重要的边界。

### 2.1 Security classification timeline

回答：

> 这只证券在日期 D 属于哪个逻辑执行 family？

示例：

```text
security: 513500

2024-01-01 .. 2025-06-30
  instrumentType=etf
  intradayRoundTripEligible=false
  -> domestic_stock_etf

2025-07-01 .. open
  instrumentType=etf
  intradayRoundTripEligible=true
  -> t0_etf
```

权威边界：

```text
Security Master
  -> SecurityExecutionProfileResolver
  -> profileId
```

### 2.2 Execution mechanics timeline

回答：

> logical profile `t0_etf` 在日期 D 应使用哪一版具体市场执行规则？

示例：

```text
t0_etf

revision A
  effectiveFrom: 2024-01-01
  effectiveTo:   2025-08-31
  lot / tick / fees / settlement / restrictions = A

revision B
  effectiveFrom: 2025-09-01
  effectiveTo:   null
  lot / tick / fees / settlement / restrictions = B
```

这条时间轴不得放入 Security Master。

Security Master 保存的是**证券事实**；Execution Profile Revision 保存的是**市场执行规则快照**。两者变化原因、数据源、更新频率和审计方式都不同。

## 3. 设计目标

1. 保持 logical profile id 稳定，不因为规则修订产生新的公共 model id。
2. 历史规则按 execution date 解析，而不是按 signal date、回测结束日或当前日期解析。
3. Security Master 不保存 fee / lot / tick / price-limit 等市场规则。
4. Portfolio 不选择规则 revision。
5. Business Policy 不知道规则 revision。
6. MCP 不暴露或实现规则选择逻辑。
7. 确定性 revision selection 只有一个权威实现。
8. 缺失历史覆盖时 fail closed；不能静默拿 current defaults 回填历史。
9. 规则来源必须可审计，但 simulation 只消费归一化后的规则快照。
10. 第一阶段不导入真实历史规则数据，先稳定契约和边界。

## 4. 非目标

本阶段不做：

- 收集上交所、深交所、税务或券商完整历史规则；
- 在 Security Master 中新增市场规则字段；
- 修改 DrawdownBuyingPolicy；
- 新增 MCP tool；
- 改变 `executionModel=frictionless` 的研究语义；
- 支持日内规则在同一个交易日内多次变化；
- 支持执行 timing 本身随 revision 变化。

最后一点需要特别说明：当前自动 Profile family 的买入 timing 都是 next-trading-day-open，因此可以先确定 candidate execution date，再选择当日生效的 rule revision。

如果未来某个规则 revision 会改变“何时成交”，必须再引入独立的 execution schedule/timing capability；不能让 EffectiveExecutionProfileProvider 反过来决定 timing。

## 5. 核心数据契约：ExecutionProfileRevision

建议新增纯数据契约：

```text
ExecutionProfileRevision
  profileId
  revisionId

  effectiveFrom
  effectiveTo?

  profile
    ExecutionProfile

  sources[]
    kind
    provider
    document
    version
    collectedAt

  qualityIssues[]
```

建议 JS 形态：

```js
{
  profileId: "legacy_a_share",
  revisionId: "legacy_a_share.rules.v1",
  effectiveFrom: "2020-01-01",
  effectiveTo: "2023-08-27",
  profile: {
    id: "legacy_a_share",
    assetClass: "a_share",
    kind: "legacy_a_share_next_open",
    ruleApproximation: "historical_rule_snapshot",
    settlement: { sharesAvailable: "next_trading_day" },
    lotRules: { buyLotSize: 100 },
    priceRules: { tickSize: 0.01 },
    feeRules: {
      commissionRate: 0.0003,
      minimumCommissionYuan: 5,
      stampDutyRate: 0.001,
    },
    restrictionRules: { kind: "a_share_market" },
    qualityIssues: [],
  },
  sources: [
    {
      kind: "rule_document",
      provider: "example_provider",
      document: "example_rule_document",
      version: "v1",
      collectedAt: "2026-08-14T00:00:00.000Z",
    },
  ],
  qualityIssues: [],
}
```

上面数值仅用于契约示例，不是仓库应写入的真实历史规则。

### 5.1 不把 revision 编进 profileId

禁止：

```text
legacy_a_share_2010
legacy_a_share_2011
legacy_a_share_2023_stamp_duty
```

原因：

- Security classification 不应知道市场规则版本；
- MCP public model ids 会无限膨胀；
- Profile family 与 rule revision 是两个不同变化轴；
- SecurityExecutionProfileResolver 会被迫依赖日期和市场规则。

正确做法：

```text
logical profileId = legacy_a_share
revisionId        = legacy_a_share.rules.vN
```

### 5.2 revision.profile.id 必须与 profileId 一致

必须满足：

```text
revision.profileId === revision.profile.id
```

这样 revision 只能改变该 family 的执行规则，不能偷偷把一个 family 替换成另一个 family。

### 5.3 日期语义

当前模拟粒度是交易日，因此 revision 也使用 ISO calendar date：

```text
YYYY-MM-DD
```

`effectiveFrom` / `effectiveTo` 采用闭区间，与现有 Security Master 日期语义保持一致。

若未来需要盘中规则变更，另开 timestamp-level 设计，不把 date contract 隐式升级成 datetime。

## 6. 新 Port：EffectiveExecutionProfileProvider

建议新增：

```text
src/ports/simulation/effective_execution_profile_provider.js
```

窄契约：

```text
resolveEffectiveProfile({
  profileId,
  asOfDate
}) -> ExecutionProfileRevision
```

职责只有一个：

> 给定 logical profile id 和规则生效日期，返回唯一生效、可审计的 ExecutionProfile revision。

它不负责：

- 读取 Security Master；
- 判断证券是不是 ETF；
- 计算 execution date；
- 构造 BuyExecutionModel；
- 执行订单；
- 产生业务 signal；
- MCP 协议转换。

## 7. 第一阶段实现：纯 Revision Catalog / Provider

第一阶段优先实现内存中的确定性 capability，不先做 IO：

```text
ExecutionProfileRevision[]
        |
        v
EffectiveExecutionProfileProvider
        |
        | profileId + asOfDate
        v
exactly one revision
```

建议实现位置：

```text
src/simulation/execution/effective_execution_profile_provider.js
```

它负责：

1. normalize / validate revision；
2. 按 `profileId` 建索引；
3. 检查同一 profile 的有效区间不能重叠；
4. 校验 `revisionId` 唯一；
5. 按 asOfDate 找唯一 revision；
6. 找不到 revision 时 fail closed；
7. 返回 immutable revision。

它不访问文件、数据库、网络。

### 7.1 为什么第一步不直接改 ExecutionProfileCatalog

当前 `ExecutionProfileCatalog` 的语义很简单：

```text
get(profileId) -> ExecutionProfile
```

它是静态 catalog。

直接改成：

```text
get(profileId, asOfDate)
```

会同时改变：

- catalog 的静态语义；
- BuyExecutionModelResolver；
- tests；
- explicit override 行为；
- 默认 current approximation 行为。

这会把“规则版本选择”和“模型构造”重新耦合起来。

因此先增加独立 capability，等契约稳定后再决定 static catalog 是否退化为 provider 的一种 source。

## 8. 与 BuyExecutionModelResolver 的边界

当前：

```text
BuyExecutionModelResolver.resolve({
  model,
  executionConfig
})

model id
  -> static ExecutionProfileCatalog
  -> ProfiledBuyExecutionModel
```

历史规则接入后，不应让 Resolver 自己根据日期查询 revision。

推荐演进为：

```text
EffectiveExecutionProfileProvider
  -> resolved ExecutionProfileRevision
  -> revision.profile
  -> BuyExecutionModelResolver
  -> ProfiledBuyExecutionModel
```

Resolver 仍然只负责“如何从已经确定的 model/profile 构造执行模型”。

最小兼容方案可以让 resolver 增加一个可选、已经解析好的 profile 输入，例如：

```text
resolve({
  model,
  executionProfile?,
  executionConfig
})
```

规则：

- `executionProfile` 缺省：保持当前 static catalog 行为；
- `executionProfile` 提供：只验证 `executionProfile.id === model` 并构造 ProfiledBuyExecutionModel；
- resolver 不接收 `asOfDate`；
- resolver 不选择 revision；
- `frictionless` 不允许伪装成 ExecutionProfile revision。

具体参数名在实现阶段再以现有代码风格确定，但职责边界必须保持。

## 9. 与 TimelineBuyExecutionModelProvider 的最终组合

当前 provider 已拥有 buy-context temporal model selection：

```text
resolveForBuy({ bars, signalDate })
```

当前内部：

```text
bars + signalDate
  -> resolveNextExecutionBar
  -> effective execution date
  -> security profile timeline
  -> logical profileId
  -> BuyExecutionModelResolver
```

历史规则接入后的目标：

```text
bars + signalDate
        |
        v
resolveNextExecutionBar
        |
        | executionDate
        v
security profile timeline
        |
        | logical profileId
        v
EffectiveExecutionProfileProvider
        |
        | profile revision effective on executionDate
        v
BuyExecutionModelResolver
        |
        v
BuyExecutionModel
```

因此 `TimelineBuyExecutionModelProvider` 是组合两个时间轴的正确 Control/Capability 边界：

1. execution date；
2. security classification timeline -> logical profileId；
3. execution mechanics timeline -> rule revision；
4. model construction。

Portfolio 仍然只调用：

```text
executionModelProvider.resolveForBuy(...)
```

Portfolio 不增加任何 revision 概念。

## 10. 两个时间轴交叉时的确定性语义

假设：

```text
signal date = 2026-06-30
execution date = 2026-07-01
```

证券分类在 2026-07-01 切换：

```text
2026-06-30 -> domestic_stock_etf
2026-07-01 -> t0_etf
```

同时 `t0_etf` 的规则 revision 也在 2026-07-01 切换：

```text
revision A ends 2026-06-30
revision B starts 2026-07-01
```

系统必须按以下顺序解析：

```text
executionDate = 2026-07-01

security timeline @ 2026-07-01
  -> t0_etf

execution rules @ (t0_etf, 2026-07-01)
  -> revision B

revision B.profile
  -> BuyExecutionModel
```

不能：

- 用 signal date 选择任一时间轴；
- 先构造 current model 再尝试修补 fee；
- 用回测 endDate 选择 revision；
- 用当前日期选择 revision。

## 11. Fail-closed 规则

以下情况必须报错：

1. `profileId` 非空字符串校验失败；
2. `asOfDate` 不是 ISO date；
3. revision 的 `effectiveTo < effectiveFrom`；
4. 同一 logical profile 的 revision 区间重叠；
5. `revision.profile.id !== revision.profileId`；
6. `revisionId` 重复；
7. sources 缺失或不可审计；
8. requested date 没有任何 revision 覆盖；
9. requested date 同时命中多个 revision；
10. revision.profile 不满足 `ExecutionProfile` contract。

特别禁止：

```text
if no historical rule revision:
  use current ExecutionProfile
```

除非调用方显式选择一个“current-rules research approximation”模式，而且结果必须带明确 quality issue。默认历史自动路径不能静默 fallback。

## 12. Provenance 与数据来源

历史规则可能来自多个变化轴：

- exchange trading rules；
- statutory tax rules；
- broker/research commission assumptions；
- repository-maintained approximation rules。

为了控制复杂度，本阶段**不为每个来源新增一个 runtime Provider**。

推荐数据管道：

```text
source adapters
  exchange docs
  tax docs
  research assumptions
        |
        v
normalization / quality gate
        |
        v
ExecutionProfileRevision snapshot
        |
        v
simulation runtime
```

Runtime 只消费已经归一化、审计过的 revision。

`sources[]` 允许一个 revision 记录多个来源，但来源合并逻辑属于数据同步/质量链路，不属于 Portfolio 或 Business。

## 13. Request executionConfig 的优先级

当前 ProfiledBuyExecutionModel 的执行配置合并顺序是：

```text
DEFAULT_SIMULATOR_CONFIG.execution
  -> profile defaults
  -> request executionConfig overrides
```

历史 revision 接入后保持：

```text
base simulator defaults
  -> effective revision.profile
  -> explicit research executionConfig overrides
```

这意味着：

- revision 表示该日期的默认市场执行假设；
- request override 明确表示研究者主动覆盖某个参数；
- override 不是历史事实；
- 输出 metadata 必须继续能看出最终生效配置。

后续可增加 `ruleRevisionId` / `ruleSource` 到 model description 或 trade metadata，方便复现。

## 14. Explicit override 语义

### 14.1 `frictionless`

保持现状：

```text
executionModel=frictionless
  -> explicit_override
  -> 不读取 Security Master
  -> 不读取 EffectiveExecutionProfileProvider
```

它是研究基准模型，不是历史市场规则。

### 14.2 显式 market profile id

例如：

```text
executionModel=legacy_a_share
```

当前行为是显式固定模型研究 override。

为了避免无声改变已有语义，第一阶段历史规则接入时**不改变 explicit_override**：

```text
explicit market profile id
  -> current existing static resolver behavior
```

未来如果需要“强制 logical family，但仍按历史 rule revision 运行”，应增加一个明确的新研究模式，而不是偷偷改变 `executionModel` 的语义。

### 14.3 request securityMetadata

`securityMetadata` 不是 model override，它是调用方提供的证券分类事实。

最终推荐语义是：

```text
request securityMetadata
  -> fixed logical profile family
  -> execution date
  -> EffectiveExecutionProfileProvider
  -> historical rule revision
```

但这一步应在 revision capability 稳定后单独接入和测试，不在第一阶段 contract slice 中同时修改。

## 15. 默认 Catalog 的兼容策略

当前静态 `DEFAULT_EXECUTION_PROFILE_CATALOG` 不应被伪装成“完整历史数据”。

第一阶段：

- 保留现有 catalog；
- 新增 revision contract/provider；
- 只用 synthetic revisions 测试；
- 不修改默认 MCP / simulation 行为。

第二阶段接入 default simulation 前，必须先决定真实 coverage：

### 方案 A：严格历史 coverage

仅当仓库有可审计 revision 时运行自动历史规则；未覆盖日期 fail closed。

优点：语义最可靠。  
缺点：会让旧 fixture / 旧历史回测在缺数据时失败。

### 方案 B：显式 approximation revision

允许一个明确标记的 approximation revision，例如：

```text
qualityIssues:
  - historical_execution_rules_unverified
  - current_rules_used_as_research_approximation
```

但必须：

- 明确 effective coverage；
- 明确来源；
- 结果暴露 quality issue；
- 不能把它描述成 authoritative historical rules。

禁止使用没有任何 provenance 的“1900-01-01 起永久有效”假数据只是为了让测试通过。

## 16. 数据持久化建议（后续阶段）

如果未来把 revisions 存进 repo，建议延续 immutable snapshot 风格，而不是可变单文件数据库语义。

候选：

```text
data/execution-rules/
  manifest.json
  revisions/
    legacy_a_share.json
    domestic_stock_etf.json
    t0_etf.json
```

或按 snapshot：

```text
data/execution-rules/
  manifest.json
  YYYY-MM-DD/
    profiles.json
```

先不要在本阶段锁死物理布局。先稳定 runtime contract；数据量、来源和更新频率明确后再选布局。

无论物理布局如何，Adapter 只负责 IO / normalization，不能决定证券分类或 Business 策略。

## 17. Architecture Fitness Rules

新增：

```text
RULE-11 Security Master 不得保存 fee/lot/tick/restriction 等 execution mechanics history。
RULE-12 EffectiveExecutionProfileProvider 不得读取 Security Master 或判断证券类型。
RULE-13 Portfolio 不得选择 ExecutionProfileRevision。
RULE-14 Business 不得依赖 ExecutionProfileRevision 或 market rule history。
RULE-15 MCP Tool 不得直接读取 execution-rules 数据。
RULE-16 BuyExecutionModelResolver 不得根据 asOfDate 选择 revision。
RULE-17 同一 profileId + date 的 revision selection 只能有一个权威实现。
RULE-18 缺失 historical rule coverage 不得静默 fallback 到 current defaults。
RULE-19 revision profileId 与 embedded ExecutionProfile.id 必须一致。
RULE-20 execution timing 若未来可变，必须通过独立 timing capability 表达，不能塞进 revision lookup 的隐式副作用。
```

允许依赖：

```text
TimelineBuyExecutionModelProvider
  -> EffectiveExecutionProfileProvider Port
  -> BuyExecutionModelResolver Port

EffectiveExecutionProfileProvider implementation
  -> ExecutionProfile / ExecutionProfileRevision pure contracts

BuyExecutionModelResolver
  -> already-resolved ExecutionProfile
  -> model construction
```

禁止依赖：

```text
Security Master -> EffectiveExecutionProfileProvider
Business -> EffectiveExecutionProfileProvider
Portfolio -> EffectiveExecutionProfileProvider
MCP Tool -> EffectiveExecutionProfileProvider concrete implementation
EffectiveExecutionProfileProvider -> SecurityExecutionProfileResolver
EffectiveExecutionProfileProvider -> Business Policy
```

## 18. 测试计划

第一阶段 contract/provider 测试：

1. 有效 revision 正常 normalize/freeze；
2. `revision.profile.id !== profileId` 拒绝；
3. 非法 effective date 拒绝；
4. `effectiveTo < effectiveFrom` 拒绝；
5. 同一 profile 区间重叠拒绝；
6. 相邻 revision 允许；
7. boundary date 精确切换 revision；
8. uncovered date fail closed；
9. duplicate revisionId 拒绝；
10. provenance/sources 缺失拒绝；
11. provider 不 import Security Master/MCP/Business；
12. contract/provider 无 IO。

后续 integration 测试：

13. security classification 不变，但 fee revision 在 execution date 切换；
14. security family 与 rule revision 同一天同时切换；
15. signal date 与 execution date 跨 revision boundary；
16. Portfolio source 不出现 revision/provider 实现；
17. explicit `frictionless` 不调用 effective profile provider；
18. explicit market model override 保持现有静态语义；
19. request securityMetadata 后续接入 historical revision 时行为可控；
20. MCP schema 完全不变。

## 19. 分阶段交付

### Phase 1：契约与纯 capability

实现：

```text
ExecutionProfileRevision contract
EffectiveExecutionProfileProvider Port
in-memory deterministic provider
unit tests
architecture fitness tests
```

不改变 production simulation behavior。

### Phase 2：模型构造接缝

让 `BuyExecutionModelResolver` 可以消费已经解析好的 ExecutionProfile，但不接收日期、不选择 revision。

### Phase 3：Temporal provider 集成

`TimelineBuyExecutionModelProvider` 在 execution date：

```text
security timeline -> logical profileId
rules provider     -> effective revision
model resolver     -> BuyExecutionModel
```

此时 production behavior 是否启用严格历史 coverage，需要根据仓库规则数据覆盖决定。

### Phase 4：规则数据与质量门

再设计：

- source adapters；
- provenance；
- snapshot/manifest；
- quality audit；
- official rule collection；
- CI coverage gate。

不要反过来为了某个数据源修改 runtime contract。

## 20. ADR

### ADR-ER-01：Security Master 与 execution rules 分离

决定：Security Master 只保存证券事实；历史交易规则进入独立 revision capability。

### ADR-ER-02：logical profile id 稳定

决定：规则版本不编码进 `profileId`，单独使用 `revisionId`。

### ADR-ER-03：按 execution date 解析 revision

决定：历史 execution mechanics 的 as-of date 必须是 candidate execution date。

### ADR-ER-04：Resolver 不选择历史版本

决定：BuyExecutionModelResolver 只构造模型；EffectiveExecutionProfileProvider 选择 revision。

### ADR-ER-05：缺失 coverage fail closed

决定：默认历史自动路径不允许静默使用 current defaults。

### ADR-ER-06：第一阶段不接真实规则数据

决定：先用 synthetic revisions 验证边界，再独立建设数据源与质量链路。

### ADR-ER-07：执行 timing 保持独立变化轴

决定：本设计只版本化不会改变 candidate execution date 的 mechanics。未来 timing 变化必须建立独立 schedule/timing capability。

## 21. 下一实现步骤

下一步只实现 Phase 1：

```text
src/ports/simulation/execution_profile_revision.js
src/ports/simulation/effective_execution_profile_provider.js
src/simulation/execution/effective_execution_profile_provider.js

tests/simulation-effective-execution-profile-provider.test.js
+ architecture fitness assertions
```

要求：

- 纯内存；
- 无 IO；
- 不接 MCP；
- 不改默认 simulation behavior；
- 不填真实历史 fee / tax / exchange 数据；
- 所有日期边界和 fail-closed 行为由单元测试证明。
