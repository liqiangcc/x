# Security Master 设计

> 日期：2026-08-12  
> 更新：2026-08-14  
> 状态：Point-in-time + Temporal Reader 已实现  
> 范围：证券身份、证券类型、交易资格事实、有效期、优先级及其可审计来源。本文不定义费用、滑点、成交时机、业务策略或 MCP 协议。

## 1. 目标

Security Master 回答：

> **证券是什么，以及在某个有效期内具备什么交易资格，这个事实来自哪里。**

它不回答：

> **应该用哪个 ExecutionProfile、什么时候成交、成交价格是多少、为什么买。**

当前数据能力分成三条独立消费链路。

### 1.1 Point-in-time 查询

```text
Repository Security Master
        |
        v
LedgerSecurityMasterReader
        |
        | readRecord(security, { asOf? })
        v
SecurityMasterRecord | null
        |
        v
LedgerSecurityMetadataReader
        |
        v
stable execution metadata projection
```

### 1.2 Temporal 查询

```text
Repository Security Master
        |
        v
LedgerSecurityMasterReader.readSnapshot()
        |
        v
LedgerSecurityMasterTimelineReader
        |
        | readTimeline(security, { startDate, endDate })
        v
segments[] + gaps[]
        |
        v
ResolveExecutionProfileTimelineUseCase
        |
        +-> SecurityExecutionProfileResolver Port
        |
        v
profile timeline
```

### 1.3 质量审计

```text
LedgerSecurityMasterReader.readSnapshot()
        |
        v
ValidateSecurityMasterUseCase
        |
        +-> SecurityMasterQualityValidator
        +-> SecurityExecutionProfileResolver Port
        |
        v
ValidationReport
        |
        v
CI / validation CLI
```

这三条链路共享同一份 Security Master facts，但消费者只依赖自己需要的 capability。

## 2. 关注点分离

职责唯一归属：

```text
SecurityMasterRecord
  -> 单条证券事实 schema / effective interval / provenance

LedgerSecurityMasterReader
  -> repository manifest / record set / explicit record IO
  -> point lookup
  -> auditable snapshot

LedgerSecurityMetadataReader
  -> SecurityMasterRecord 的窄投影

LedgerSecurityMasterTimelineReader
  -> 一个证券在区间内的事实变化边界与 coverage gaps

SecurityMasterQualityValidator
  -> 纯确定性数据质量规则

ResolveExecutionProfileTimelineUseCase
  -> 把 fact segments 编排成 profile segments

SecurityExecutionProfileResolver
  -> 单个证券事实映射为 profile id

ExecutionProfile / ExecutionModel
  -> 市场执行假设与执行机制

Business Policy
  -> 为什么产生 signal
```

Security Master 不得包含 execution profile id，也不得知道 Profile Catalog 或 concrete ExecutionModel。

## 3. SecurityMasterRecord

统一记录：

```text
SecurityMasterRecord
  security
    code
    market

  instrumentType
    a_share
    etf

  intradayRoundTripEligible
    boolean

  effectiveFrom
  effectiveTo | null

  source
    provider
    document
    version
    collectedAt

  qualityIssues[]
```

约束：

1. `security.code` 必须是六位证券代码；
2. `security.market` 必须是非负整数；
3. `instrumentType` 当前允许 `a_share | etf`；
4. `intradayRoundTripEligible` 必须显式为 boolean；
5. 当前支持的 A 股事实不得声明 `intradayRoundTripEligible=true`；
6. `effectiveFrom` 必须是有效 ISO 日期；
7. `effectiveTo` 若存在，不得早于 `effectiveFrom`；
8. `source.provider/document/version/collectedAt` 必须可追溯；
9. `qualityIssues` 归一化、去重、排序。

记录中禁止出现：

- `legacy_a_share` / `domestic_stock_etf` / `t0_etf`；
- lot size / tick size；
- commission / stamp duty / slippage；
- fill timing；
- T+1/T+0 settlement 实现；
- drawdown 策略参数；
- MCP / HTTP / SQLite / 文件系统实现知识。

证券身份和资格基础规范化由 `src/market/security_execution_metadata.js` 提供单一权威实现，Security Master 与 classification resolver 复用。

## 4. Repository Manifest

统一入口：

```text
data/security_master/manifest.json
```

manifest 支持：

```text
recordSets[]
records[]
```

`recordSets` 适合引用仓库已有不可变证券集合，例如沪深 A 股 universe snapshot，避免复制数千条相同分类事实。

`records` 适合逐证券、带有效期、来源更明确的事实，例如 ETF 的 T+0 eligibility。

关键规则：

- 分类事实必须写入数据契约，不能由 Adapter 根据 `51xxxx` / `15xxxx` 等前缀猜测；
- 名称包含 `ETF` 也不是资格证据；
- 显式 records 可以按既定 priority 覆盖较粗粒度 record set facts；
- priority 只属于 repository/audit 语义，不进入 ExecutionProfile；
- 引用路径必须限制在 `dataRoot` 内。

## 5. Reader Capability 边界

### 5.1 SecurityMasterReader

`src/ports/market/security_master_reader.js` 的 point lookup：

```text
readRecord(security, { asOf? })
  -> SecurityMasterRecord | null
```

回答：

> “这个证券在 `asOf` 当天的最高优先级有效事实是什么？”

不传 `asOf` 时可以返回最新有效事实，用于显式 point-in-time 消费场景。

找不到可信事实返回 `null`，不得猜测证券类型。

### 5.2 SecurityMasterSnapshotReader

同一 Port 模块保留独立 snapshot capability：

```text
readSnapshot()
  -> {
       available,
       entries[],
       source
     }
```

entry 在 Record 之外允许带审计信息：

```text
record
priority
origin
```

point reader 与 snapshot reader 分开 assertion，避免消费者被迫依赖不需要的方法。

### 5.3 SecurityMasterTimelineReader

`src/ports/market/security_master_timeline_reader.js` 定义独立 temporal capability：

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

它回答：

> “这个证券在一个闭区间内，最高优先级有效事实如何变化？哪些日期没有可信事实覆盖？”

它不返回 profile id，也不构造 execution model。

## 6. LedgerSecurityMasterReader

职责：

- 读取 manifest；
- 解析受支持 record set 和 explicit records；
- 归一化为 `SecurityMasterRecord`；
- 保留 priority / origin 供 snapshot audit 与 temporal winner selection 使用；
- 提供 `readRecord()`；
- 提供 `readSnapshot()`；
- 对不可变 snapshot 做缓存；
- 阻止 path escape；
- 损坏数据 fail closed。

它不知道：

- execution profile id；
- Profile Catalog；
- BuyExecutionModel；
- Business Policy；
- MCP Tool。

## 7. LedgerSecurityMetadataReader

`LedgerSecurityMetadataReader` 是 point-in-time 投影 Adapter：

```text
SecurityMasterRecord
  -> instrumentType
  -> intradayRoundTripEligible
  -> effectiveFrom/effectiveTo
  -> source
  -> qualityIssues
```

它只依赖 `SecurityMasterReader Port`，不解析 manifest、不直接读 universe、不自行分类。

该 capability 仍可用于明确的 point lookup / 兼容场景；当前 `simulation_run_drawdown_buying` 的默认 automatic path 已升级为 temporal timeline，不再用一个 point fact 覆盖整个回测区间。

## 8. LedgerSecurityMasterTimelineReader

`src/adapters/ledger/ledger_security_master_timeline_reader.js` 负责从 snapshot 投影一个证券的 temporal facts。

算法职责：

1. 过滤目标 security；
2. 只保留与 requested range 相交的 facts；
3. 收集 `effectiveFrom` 和 `effectiveTo + 1 day` 作为变化边界；
4. 对每个子区间选择当日最高优先级有效 fact；
5. 有 winner -> `segments[]`；
6. 无 winner -> `gaps[]`；
7. 相邻且同一 winner 的区间合并。

输出仍然是 **SecurityMasterRecord facts**，不是 Profile。

有效期使用闭区间：

```text
fact A: 2026-01-01 .. 2026-06-30
fact B: 2026-07-01 .. null
```

因此切换边界为 2026-07-01。

Timeline Reader 不知道交易日历；它表达的是事实在**日历日期**上的有效性。交易行为在哪一天发生属于 execution/simulation 层。

## 9. Temporal Application

`src/application/simulation/resolve_execution_profile_timeline.js` 是 Security Master 与 simulation execution 之间的 Application 编排层。

流程：

```text
SecurityMasterTimelineReader
  -> fact segments + gaps
  -> validate complete coverage
  -> project stable metadata
  -> SecurityExecutionProfileResolver
  -> profile segments
```

为什么不让 Ledger timeline reader 直接返回 profile id：

- repository facts 与 execution architecture 是两个变化轴；
- Security Master 可以被非 simulation 消费者复用；
- profile catalog / resolver 演进不应修改数据 Adapter；
- 质量审计仍可独立验证原始事实。

Temporal Application 会再次检查完整覆盖，即使 Reader 声称 `gaps=[]`，也不能静默接受 segment hole。

## 10. 时间语义

### 10.1 已实现

Security Master 的时间能力现在不是“未来设计”，已经有：

```text
point-in-time readRecord(asOf)
+
range readTimeline(startDate, endDate)
```

因此历史模拟可以看到区间内部证券事实变化，而不是只拿结束日状态代表整个历史。

### 10.2 Security Master 不决定成交日期

Security Master 只定义：

```text
fact effective on calendar date D
```

它不定义：

```text
signal on D
order created on D
fill on D+1
settlement on D+1 / D+2
```

这些属于 execution semantics。

当前 simulation Temporal v1 在 Portfolio 中按 `order.date` 选择 execution model；实际 Profiled model 通常在下一交易 bar 成交。因此“规则应该按 signal date 还是 actual execution date 生效”是 simulation 下一阶段问题，不能通过修改 Security Master 数据契约解决。

## 11. Security Master 质量门禁

### 11.1 Pure Logic Validator

`src/market/security_master_quality_validator.js` 不做 IO。

当前重要规则：

- 无法规格化 -> `invalid_security_master_record`；
- 同优先级等价重复窗口 -> `duplicate_security_fact_window`；
- 同优先级重叠窗口 -> `overlapping_security_fact_windows`；
- 重叠且分类事实冲突 -> `conflicting_security_fact_overlap`；
- 低优先级被完整覆盖 -> warning `shadowed_security_fact_window`；
- 低优先级部分重叠 -> warning `shadowed_security_fact_overlap`。

error 阻断；warning 不阻断。

### 11.2 Audit Application

`ValidateSecurityMasterUseCase`：

1. 通过 snapshot capability 获取 entries；
2. 调用纯 Validator；
3. 对有效 record 调 `SecurityExecutionProfileResolver Port` 验证可解析性；
4. 汇总稳定 ValidationReport。

Application 不读 filesystem，也不依赖 concrete Ledger implementation。

### 11.3 CI / CLI

`scripts/validate_security_master.js` 是薄 Adapter：

```text
LedgerSecurityMasterReader
        +
SecurityExecutionProfileResolver
        ↓
ValidateSecurityMasterUseCase
        ↓
console / exit code
```

CI 在单元测试后显式执行 Security Master validation，使错误主数据在提交阶段阻断，而不是等 simulation 偶然触发。

## 12. ETF 数据原则

ETF 的 `intradayRoundTripEligible` 必须来自可审计事实。

禁止：

```text
if code startsWith("51") -> ETF
if code startsWith("15") -> ETF
if name includes("ETF")  -> ETF
all ETF -> T+0
```

正确链路：

```text
official / accepted source
   -> normalized ETF security facts
   -> Security Master persistence
   -> quality gate
   -> temporal reader
   -> classification resolver
```

`frictionless` 不是 Security Master fact，也不是证券类型。

## 13. Architecture Fitness

持续保证：

- Security Master 不包含 profile id；
- `SecurityMasterRecord` Logic 不依赖 IO / MCP / simulation mechanics；
- `LedgerSecurityMasterReader` 负责 repository IO，但不知道 Profile / ExecutionModel；
- `LedgerSecurityMetadataReader` 只做 point projection；
- `LedgerSecurityMasterTimelineReader` 只做 temporal fact projection；
- Timeline Reader 依赖 snapshot capability，而不是 concrete Ledger reader；
- Temporal Application 只依赖 TimelineReader Port + classification resolver Port；
- MCP Tool 不读取 Security Master；
- Composition Root 才做 concrete wiring；
- 路径不能逃逸 `dataRoot`；
- unknown / uncovered dates fail closed；
- 不存在 prefix inference。

核心测试：

```text
tests/security-master.test.js
tests/security-master-quality.test.js
tests/security-master-temporal.test.js
tests/simulation-security-execution-profile-resolver.test.js
tests/simulation-execution-boundary.test.js
tests/mcp-composition-root.test.js
```

## 14. 已实现组件

```text
src/market/security_execution_metadata.js
src/market/security_master_record.js
src/market/security_master_quality_validator.js

src/ports/market/security_master_reader.js
src/ports/market/security_master_timeline_reader.js

src/adapters/ledger/ledger_security_master_reader.js
src/adapters/ledger/ledger_security_metadata_reader.js
src/adapters/ledger/ledger_security_master_timeline_reader.js

src/application/market/validate_security_master.js
src/application/simulation/resolve_execution_profile_timeline.js

scripts/validate_security_master.js
data/security_master/manifest.json
```

## 15. 当前结论

Security Master 已从：

```text
one latest fact lookup
```

演进为：

```text
point fact lookup
+
auditable snapshot
+
temporal fact timeline
```

并保持：

```text
facts != profile ids
facts != execution mechanics
temporal data coverage != fill scheduling
storage != business rules
```

这使后续跨境 ETF、黄金 ETF、债券 ETF 或资格变化可以优先通过**新增有来源、有有效期的数据事实**扩展，而不是增加代码前缀判断或复制执行类。