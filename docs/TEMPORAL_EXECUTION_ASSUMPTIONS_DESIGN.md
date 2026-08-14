# Temporal Execution Assumptions Design

> 日期：2026-08-14  
> 状态：设计完成，待增量实现  
> 范围：历史回测中 `ExecutionProfile` 的费用、lot、tick、settlement、restriction 等执行假设如何按有效期变化。本文不定义证券分类，不改变 Business Policy，也不新增 MCP 协议。

## 1. 问题

Temporal Security Classification 已经解决了：

```text
security facts over time
    -> profile id timeline
    -> BuyExecutionModelProvider.resolveForBuy({ bars, signalDate })
    -> candidate execution date
    -> effective profile family
```

当前 Provider 自己复用共享 `resolveNextExecutionBar` Logic 决定规则生效日，Portfolio 只传 buy context，不计算成交日期。

但仍有第二个独立时间维度没有建模：**同一个 profile id 的执行参数本身也可能随历史日期变化**。

当前 `ExecutionProfileCatalog` 对每个公开 profile id 只保存一份静态对象：

```text
legacy_a_share
  lotRules
  priceRules
  feeRules
  settlement
  restrictionRules

domestic_stock_etf
  ...

t0_etf
  ...
```

因此历史模拟即使正确选择了 `legacy_a_share`，仍然会使用仓库当前这份 `legacy_a_share` 参数覆盖整个历史区间。

这与证券分类时间轴是两个完全不同的变化轴：

```text
证券事实变化
  instrument type / ETF T+0 eligibility

市场执行规则变化
  fee / tax / lot / tick / settlement / restriction assumptions
```

不能把两者重新揉回一个模型。

## 2. 核心决策

### 2.1 `profileId` 保持稳定，不带日期版本

禁止通过以下方式表达历史变化：

```text
legacy_a_share_2023
legacy_a_share_2024
etf_t0_after_2026
```

公开 `profileId` 表示稳定的执行族，而不是规则版本。

原因：

1. `SecurityExecutionProfileResolver` 的职责只是“证券事实属于哪个执行族”；
2. 如果 profile id 带日期，证券分类 resolver 就会被迫知道市场规则时间；
3. MCP schema、研究 override、测试都会被大量日期版本 id 污染；
4. 同一个证券类别的规则修改会制造无意义的新“证券类型”。

保持：

```text
legacy_a_share
domestic_stock_etf
t0_etf
```

历史规则版本由独立 revision 表达。

### 2.2 `ExecutionProfile` 继续是一份不可变执行快照

现有 `ExecutionProfile` contract 不加入：

- `effectiveFrom/effectiveTo`；
- filesystem path；
- provider URL；
- collectedAt；
- repository priority。

它继续只描述“这一份执行假设是什么”。

这样 `ProfiledBuyExecutionModel` 仍然只消费纯数据快照，不知道历史查询、存储或来源选择。

### 2.3 新增 `ExecutionProfileRevision` 包装时间与证据

建议契约：

```text
ExecutionProfileRevision
  revisionId
  profileId
  effectiveFrom
  effectiveTo | null

  profile
    ExecutionProfile

  source
    provider
    document
    version
    collectedAt

  qualityIssues[]
```

硬规则：

```text
revision.profile.id === revision.profileId
```

`revisionId` 只用于审计和缓存，不进入证券分类，也不成为 MCP 的 executionModel 枚举。

## 3. 数据边界

### 3.1 Security Master 不保存执行参数

Security Master 继续只保存证券事实：

```text
security
instrumentType
intradayRoundTripEligible
effectiveFrom/effectiveTo
source
qualityIssues
```

禁止加入：

```text
commissionRate
stampDutyRate
minimumCommissionYuan
buyLotSize
tickSize
priceLimitPct
settlement implementation
```

原因：Security Master 的变化粒度是“证券”，执行规则的变化粒度通常是“市场/profile family”。把执行规则复制到每只证券会制造巨量重复数据，也会把两个变化轴耦合。

### 3.2 独立 Execution Profile Revision 数据集

建议未来仓库布局：

```text
data/execution_profiles/
  manifest.json
```

最小 manifest：

```json
{
  "schemaVersion": 1,
  "revisions": [
    {
      "revisionId": "...",
      "profileId": "legacy_a_share",
      "effectiveFrom": "YYYY-MM-DD",
      "effectiveTo": null,
      "profile": {
        "id": "legacy_a_share",
        "assetClass": "a_share",
        "kind": "legacy_a_share_next_open",
        "ruleApproximation": "...",
        "settlement": {},
        "lotRules": {},
        "priceRules": {},
        "feeRules": {},
        "restrictionRules": {},
        "qualityIssues": []
      },
      "source": {
        "provider": "...",
        "document": "...",
        "version": "...",
        "collectedAt": "..."
      },
      "qualityIssues": []
    }
  ]
}
```

**第一阶段不得为了填满历史区间而编造真实规则日期。** 在没有可信来源覆盖前，只实现契约、Reader、测试 fixture 和质量校验，不把猜测数据接入默认自动回测。

## 4. Port：ExecutionProfileTimelineReader

建议新增独立 Port：

```text
readTimeline({
  profileId,
  startDate,
  endDate
})
  -> {
       profileId,
       startDate,
       endDate,
       segments: [
         {
           startDate,
           endDate,
           revision
         }
       ],
       gaps: [
         { startDate, endDate }
       ],
       source
     }
```

职责：

- 从规则数据源读取一个 profile family 的有效版本；
- 生成最小 change boundaries；
- 明确报告 coverage gaps；
- 返回已验证的 `ExecutionProfileRevision`。

不得：

- 读取 Security Master；
- 判断证券是 ETF 还是 A 股；
- 生成 BuyExecutionModel；
- 产生 Business signal；
- 知道 MCP。

## 5. Application：组合两个时间轴

自动历史模拟需要组合：

```text
A. Security profile family timeline
   security + date -> profileId

B. Execution assumptions timeline
   profileId + date -> ExecutionProfileRevision
```

新增 Application capability，建议名：

```text
ResolveExecutionAssumptionTimelineUseCase
```

它依赖两个已经分离的能力：

```text
ExecutionProfileTimelineResolver   // security facts -> profile family segments
ExecutionProfileTimelineReader     // profile family -> rule revision segments
```

输出：

```text
ExecutionAssumptionTimeline
  segments: [
    {
      startDate,
      endDate,
      profileId,
      revisionId,
      executionProfile,
      source,
      qualityIssues
    }
  ]
```

组合算法只做区间交集：

```text
security profile segment
        ∩
profile revision segment
        =
execution assumption segment
```

任何一边有 gap 都 fail closed。

Application 不解析文件、不硬编码规则日期、不构造 concrete model，也不计算成交日期。

## 6. Model construction 边界

当前 `BuyExecutionModelResolver`：

```text
resolve({ model, executionConfig })
```

最小演进建议：

```text
resolve({
  model,
  executionConfig,
  executionProfile?   // optional resolved snapshot
})
```

语义：

```text
executionProfile supplied
  -> assertExecutionProfile
  -> executionProfile.id must equal normalized model id
  -> build ProfiledBuyExecutionModel from supplied snapshot

executionProfile omitted
  -> keep current catalog lookup behavior
```

特殊模型：

```text
frictionless
```

不得接受外部 `executionProfile`，因为它不是 profile-backed 市场规则，而是显式研究对照模型。

这样仍然保持：

> Resolver 负责“如何构造模型”，Timeline/Application 负责“哪份规则快照在这个日期有效”。

## 7. TimelineBuyExecutionModelProvider 演进

当前 Provider Port：

```text
resolveForBuy({ bars, signalDate }) -> BuyExecutionModel
```

Port 不需要变化。

当前 timeline segment：

```text
{ startDate, endDate, profileId }
```

未来自动历史路径使用：

```text
{
  startDate,
  endDate,
  profileId,
  revisionId,
  executionProfile
}
```

`resolveForBuy({ bars, signalDate })`：

1. 调用唯一的 `resolveNextExecutionBar` Logic；
2. 取 candidate execution date，若没有下一 bar 则保持现有 no-fill fallback 语义；
3. 按 effective date 找到 assumption segment；
4. 用 `profileId + revisionId` 作为模型缓存 key；
5. 调用 `BuyExecutionModelResolver.resolve({ model: profileId, executionProfile, executionConfig })`；
6. 返回 BuyExecutionModel。

这样 timing ownership 保持在 execution provider，而不是 Portfolio。

Provider 不读取规则文件，也不做两个时间轴的区间交集。

## 8. Portfolio 边界保持不变

Portfolio 继续只知道：

```text
executionModel
或
executionModelProvider.resolveForBuy({ bars, signalDate })
```

Portfolio 不得：

- import `resolveNextExecutionBar`；
- 计算 candidate execution date；
- 查询 profile revision；
- 读 Security Master；
- 读 execution-profile manifest；
- 映射 profile id；
- 构造 concrete model。

这个边界由 architecture fitness test 固化。

## 9. 三种调用模式的语义

### 9.1 默认自动历史模式

```text
executionModel omitted
securityMetadata omitted
```

最终目标：

```text
Security Master timeline
  -> profile family timeline

Execution Profile Revision timeline
  -> effective rule snapshots

两者交集
  -> execution assumption timeline
  -> TimelineBuyExecutionModelProvider
  -> resolveForBuy
  -> Portfolio
```

这是需要历史正确性的主路径。

### 9.2 request `securityMetadata`

当前实现把 request metadata 映射成一个静态 profile model。

后续接入 execution assumptions timeline 时，应该把 request metadata 只视为“证券分类事实 override”：

```text
request metadata
  -> one profile-family segment
  -> still intersect with execution-rule revisions
```

这样调用方覆盖证券分类时，不会顺便冻结整个历史区间的市场费用规则。

这是后续集成步骤，不在第一批 contract 实现里悄悄改变现有行为。

### 9.3 explicit `executionModel`

显式：

```text
executionModel = legacy_a_share | domestic_stock_etf | t0_etf | frictionless
```

继续表示**研究 override**。

当前保持使用 catalog 的静态模型，不自动引入历史 revision，以确保显式对照实验的语义不被悄悄改变。

如果未来需要“显式 family + 指定规则时点”，应增加独立参数/能力，而不是改变现有 override 的默认含义。

## 10. Quality / fail-closed

`ExecutionProfileRevision` 质量规则至少包括：

1. `profileId` 必须是稳定公开 profile family id；
2. `revisionId` 非空且在数据集中唯一；
3. `effectiveFrom/effectiveTo` 是有效 ISO 日期；
4. `effectiveTo >= effectiveFrom`；
5. `profile.id === profileId`；
6. `profile` 通过现有 `assertExecutionProfile`；
7. provenance 必填；
8. 同一 `profileId` 的 revision 不允许重叠；
9. 自动历史路径要求的区间不得有 gap；
10. 不允许用未来 revision 向过去填洞；
11. 不允许根据当前日期选择“最近版本”来掩盖历史缺口。

第一版不引入 priority/override 规则。若同一 profile family 出现重叠 revision，直接报错，比复制 Security Master 的优先级机制更简单、更安全。

## 11. 关注点分离

允许：

```text
ExecutionProfileRevision Logic -> ExecutionProfile contract
ExecutionProfileTimelineReader Adapter -> revision normalizer / repository IO
ResolveExecutionAssumptionTimelineUseCase -> temporal profile capability + revision reader Port
TimelineBuyExecutionModelProvider -> resolveNextExecutionBar Logic + BuyExecutionModelResolver Port
BuyExecutionModelResolver -> ProfiledBuyExecutionModel construction
ProfiledBuyExecutionModel -> immutable ExecutionProfile snapshot
Portfolio -> BuyExecutionModelProvider Port
```

禁止：

```text
Security Master -> fee / lot / tick / restriction history
Business Policy -> profile revision / market rules
MCP Tool -> execution rule files / revision reader
Portfolio -> execution timing / execution rule repository
ExecutionProfileTimelineReader -> security classification
BuyExecutionModelResolver -> filesystem / network / Security Master
ProfiledBuyExecutionModel -> effective-date lookup
```

## 12. 单一权威实现

目标职责：

```text
security fact history
  -> Security Master

security facts -> profile family id
  -> SecurityExecutionProfileResolver

profile family historical mechanics
  -> ExecutionProfileRevision dataset

revision schema / dates / provenance
  -> ExecutionProfileRevision Logic

profile revision timeline IO
  -> ExecutionProfileTimelineReader Adapter

two timeline intersection
  -> ResolveExecutionAssumptionTimelineUseCase

buy context -> candidate execution date
  -> resolveNextExecutionBar Logic

date + assumption segment -> resolved model
  -> TimelineBuyExecutionModelProvider

resolved profile snapshot -> model
  -> BuyExecutionModelResolver / ProfiledBuyExecutionModel

account / order loop
  -> BuyOnlyPortfolioSimulator
```

## 13. 增量实现顺序

### Phase A：contract only

先实现：

```text
ExecutionProfileRevision normalizer/assertion
ExecutionProfileTimelineReader Port
pure timeline validation/intersection Logic
```

只使用测试 fixture，不改变默认 simulation。

验收：

- 有效 revision；
- 非法日期区间；
- profile id mismatch；
- overlap；
- gap；
- provenance 缺失；
- 两个 timeline 的 change boundary 正确交集。

### Phase B：model construction extension

扩展 `BuyExecutionModelResolver` 支持已解析 `executionProfile` snapshot。

补测试：

- supplied profile snapshot 构造通用 Profiled model；
- profile id mismatch fail closed；
- `frictionless` 拒绝 profile snapshot；
- legacy static catalog path 完全兼容。

### Phase C：provider support

让 `TimelineBuyExecutionModelProvider` 支持 revision-aware segments，并按：

```text
profileId + revisionId
```

缓存模型。

保持 `resolveForBuy({ bars, signalDate })` Port 不变，并继续由 Provider 拥有 execution timing。

### Phase D：repository adapter / quality

新增 Ledger reader + `data/execution_profiles/manifest.json` contract 与 CI quality validator。

**在没有可信来源前不提交伪造的真实历史规则。**

### Phase E：automatic simulation integration

只有当默认回测所需区间拥有可信 revision coverage 后，才把默认 temporal simulation 从：

```text
profile id timeline
```

升级为：

```text
execution assumption timeline
```

并保持 MCP schema 不变。

## 14. 第一批实现范围

下一次代码提交只做 Phase A：

```text
ExecutionProfileRevision Logic
ExecutionProfileTimelineReader Port
pure timeline intersection/coverage tests
architecture fitness tests
```

明确不做：

- 真实历史费率录入；
- 网络抓取；
- MCP schema 变化；
- 默认回测行为变化；
- 新 concrete execution model；
- Security Master 字段扩张。

这样可以先把新的变化轴固定下来，再决定真实市场规则的数据来源与同步策略。