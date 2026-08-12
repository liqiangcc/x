# Security Master 设计

> 日期：2026-08-12  
> 状态：已实现  
> 范围：证券身份、证券类型、交易资格事实及其可审计来源。本文不定义交易费用、滑点、成交时机、业务策略或 MCP 协议。

## 1. 目标

Security Master 解决的是“**证券是什么，以及在某个有效期内具备什么资格**”，而不是“如何成交”。

当前链路：

```text
Repository data
    |
    v
LedgerSecurityMasterReader
    |
    | SecurityMasterRecord
    v
LedgerSecurityMetadataReader
    |
    | execution metadata projection
    v
SecurityExecutionProfileResolver
    |
    | profile id
    v
BuyExecutionModelResolver
```

质量门禁独立存在：

```text
Repository Security Master
        |
        v
LedgerSecurityMasterReader.readSnapshot()
        |
        v
ValidateSecurityMasterUseCase
        |
        +-> SecurityMasterQualityValidator
        |      deterministic record checks
        |
        +-> SecurityExecutionProfileResolver Port
               profile resolvability check
        |
        v
ValidationReport
        |
        v
CI / validation CLI
```

关注点保持独立：

- Security Master：事实与证据；
- SecurityMetadataReader：面向 simulation Application 的窄投影；
- SecurityMasterQualityValidator：证券主数据本身的确定性质量规则；
- Security Master audit Application：组合 snapshot 与 profile resolvability；
- SecurityExecutionProfileResolver：事实到 profile id 的纯确定性映射；
- ExecutionProfile / ExecutionModel：市场执行假设与成交机制；
- Business Policy：为什么买、何时产生业务 signal。

已实现组件：

```text
src/market/security_execution_metadata.js
src/market/security_master_record.js
src/market/security_master_quality_validator.js
src/ports/market/security_master_reader.js
src/adapters/ledger/ledger_security_master_reader.js
src/adapters/ledger/ledger_security_metadata_reader.js
src/application/market/validate_security_master.js
scripts/validate_security_master.js
data/security_master/manifest.json
tests/security-master.test.js
tests/security-master-quality.test.js
```

## 2. SecurityMasterRecord

统一记录契约：

```text
SecurityMasterRecord
  security
    code
    market

  instrumentType
    a_share
    etf

  intradayRoundTripEligible

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
3. `instrumentType` 当前只允许 `a_share` / `etf`；
4. `intradayRoundTripEligible` 必须显式为 boolean；
5. 当前支持的 A 股事实不得声明 `intradayRoundTripEligible=true`；
6. `effectiveFrom` 必须是有效日期；
7. `effectiveTo` 若存在，不得早于 `effectiveFrom`；
8. `source.provider/document/version/collectedAt` 必须存在，使事实可追溯；
9. `qualityIssues` 去重、排序，避免消费者各自解释质量状态。

SecurityMasterRecord 是纯数据事实，不包含：

- `legacy_a_share` / `domestic_stock_etf` / `t0_etf` 等 execution profile id；
- 手数、tick size、佣金、印花税；
- T+1 settlement 实现；
- 滑点；
- drawdown 策略参数；
- MCP/HTTP/SQLite/文件系统知识。

证券身份和执行资格的基础规范化由 `src/market/security_execution_metadata.js` 提供单一权威实现；Security Master 和 `SecurityExecutionProfileResolver` 复用同一份确定性 Logic，不再各自复制 A 股/ETF/T+0 校验规则。

## 3. Repository Manifest

仓库使用 `data/security_master/manifest.json` 作为统一入口。

为了避免把当前 5534 只沪深 A 股复制成第二份静态证券清单，manifest 声明可审计的 record set：

```json
{
  "schemaVersion": 1,
  "recordSets": [
    {
      "kind": "universe_snapshot",
      "path": "universe/20260701/stocks.json",
      "effectiveFrom": "2026-07-01",
      "effectiveTo": null,
      "classification": {
        "instrumentType": "a_share",
        "intradayRoundTripEligible": false
      },
      "source": {
        "provider": "eastmoney_clist",
        "document": "data/universe/20260701/stocks.json",
        "version": "20260701",
        "collectedAt": "2026-07-01T15:27:03.310Z"
      },
      "qualityIssues": [
        "classification_inherited_from_hs_a_universe_snapshot"
      ]
    }
  ],
  "records": []
}
```

`recordSets` 只描述“这批权威记录如何归一化成 SecurityMasterRecord”，分类事实必须写在数据中，不能由 Adapter 根据代码前缀猜测。

`records` 用于未来加入逐证券、带有效期的显式事实。例如 ETF 的 `intradayRoundTripEligible` 必须来自明确的数据记录，而不是 `51xxxx` / `15xxxx` 等号段规则。

显式 `records` 的优先级高于 record set 派生记录，以便更高质量的逐证券事实覆盖较粗粒度来源。

## 4. Reader 边界

### 4.1 SecurityMasterReader Port

主查询能力保持最窄：

```text
readRecord(security, { asOf? }) -> SecurityMasterRecord | null
```

职责：

- 返回统一、已验证的 SecurityMasterRecord；
- 可按 `asOf` 选择有效记录；
- 找不到可信记录时返回 `null`。

不得：

- 选择 execution profile；
- 构造 ExecutionModel；
- 判断投资策略；
- 暴露原始 manifest/universe JSON 给 simulation Application。

### 4.2 SecurityMasterSnapshotReader capability

质量审计需要全量事实，因此在同一个 Port 模块中提供独立 capability assertion：

```text
readSnapshot() -> {
  available,
  entries[],
  source
}
```

`assertSecurityMasterReader` 仍只要求 `readRecord()`；`assertSecurityMasterSnapshotReader` 只要求 `readSnapshot()`。两种消费者不会被迫依赖对方不需要的能力。

Snapshot entry 在 SecurityMasterRecord 之外只携带审计元数据：

```text
record
priority
origin
```

`priority/origin` 用于识别显式记录覆盖 record set 的情况，不进入业务执行 metadata。

### 4.3 LedgerSecurityMasterReader

职责：

- 读取 repository Security Master manifest；
- 将受支持的 record set 和显式 records 归一化；
- 校验数据契约；
- 仅允许读取 `dataRoot` 内的相对路径；
- 对主查询提供 `readRecord()`；
- 对质量审计提供 `readSnapshot()`；
- 缓存不可变 snapshot 的归一化结果。

缺失 Security Master 时主查询返回无记录；损坏、引用文件缺失或违反契约的数据暴露错误，而不是悄悄猜一个证券类型。质量审计会把这些加载错误转成稳定 ValidationReport error。

当前 `universe_snapshot` 被视为不可变 snapshot；Reader 的缓存失效以 manifest 变化为边界。若未来允许原地修改被引用 snapshot，应把内容哈希/被引用文件签名纳入 manifest，而不是让 Reader 隐式探测所有文件。

### 4.4 LedgerSecurityMetadataReader

只负责投影：

```text
SecurityMasterRecord
    -> instrumentType
    -> intradayRoundTripEligible
    -> effectiveFrom/effectiveTo
    -> source
    -> qualityIssues
```

它只依赖 `SecurityMasterReader Port`，不直接构造 `LedgerSecurityMasterReader`，也不再知道 `data/universe`、manifest 或文件系统结构。具体存储 wiring 由 Composition Root 完成。

## 5. 时间语义

Security Master 从第一版就保存 `effectiveFrom/effectiveTo`，但本阶段不把“执行资格在一个回测区间内变化”偷偷塞进现有单 profile 模拟器。

规则：

- `SecurityMasterReader` 支持显式 `asOf` 查询；
- 不传 `asOf` 时返回最高优先级的最新可用事实，用于保持当前 simulation auto-selection 语义；
- 历史模拟若未来需要精确处理区间内资格变化，应建立独立的 temporal execution-profile capability，让执行 profile 随交易日变化，而不是让 Application 在一次模拟开始前猜一个历史状态。

因此数据契约先具备时间能力，业务执行语义后续单独演进。

## 6. Security Master 质量门禁

### 6.1 纯确定性 Validator

`src/market/security_master_quality_validator.js` 只消费记录/entry，不读取文件、不访问网络、不依赖 MCP、Port 或 execution implementation。

当前规则：

- 单条 Record schema / provenance 无法规范化：`invalid_security_master_record`，error；
- 同证券、同优先级、同事实、完全相同有效期重复：`duplicate_security_fact_window`，error；
- 同证券、同优先级、同事实、有效期重叠：`overlapping_security_fact_windows`，error；
- 同证券有效期重叠且 `instrumentType` / `intradayRoundTripEligible` 冲突：`conflicting_security_fact_overlap`，error；
- 跨优先级的等价完整覆盖：`shadowed_security_fact_window`，warning；
- 跨优先级的等价部分重叠：`shadowed_security_fact_overlap`，warning。

有效期按闭区间处理，所以：

```text
2026-01-01 .. 2026-06-30
2026-07-01 .. null
```

不重叠；而第一条若到 `2026-07-01`，则与第二条在 7 月 1 日重叠。

warning 不阻断 CI；error 阻断。

### 6.2 Audit Application

`ValidateSecurityMasterUseCase` 负责控制/编排：

1. 通过 `SecurityMasterSnapshotReader` 获取全量归一化 entry；
2. 调用纯 Validator；
3. 对每个有效 SecurityMasterRecord 调用 `SecurityExecutionProfileResolver Port`；
4. Resolver 无法得到稳定 profile id 时产生 `security_execution_profile_unresolvable`；
5. manifest 缺失产生 `security_master_unavailable`；
6. manifest/引用文件/路径/JSON 加载失败产生 `security_master_snapshot_load_failed`；
7. 汇总稳定 ValidationReport。

Application 不读取 filesystem，也不依赖 Ledger concrete implementation。

### 6.3 CI Gate / CLI Adapter

`scripts/validate_security_master.js` 是薄 CLI Adapter，只负责 concrete wiring、格式化报告与退出码：

```text
LedgerSecurityMasterReader
        +
SecurityExecutionProfileResolver
        ↓
ValidateSecurityMasterUseCase
        ↓
console / exit code
```

`.github/workflows/ci.yml` 在 unit tests 后显式运行：

```text
node scripts/validate_security_master.js
```

因此错误的 Security Master 数据不能仅靠 simulation 运行时偶然发现，而是在提交阶段直接阻断。

## 7. 扩展原则

新增跨境 ETF、黄金 ETF、债券 ETF 等时，优先顺序：

```text
新增/同步 Security Master 数据
        ↓
Security Master quality gate
        ↓
现有 SecurityExecutionProfileResolver 是否已能映射？
        |
        +-- 是 -> 不新增执行类
        |
        +-- 否 -> 新增通用 profile / capability
```

禁止通过新增：

```text
if code startsWith(...)
if name includes("ETF")
```

来代替证券主数据。

## 8. Architecture Fitness

当前测试持续保证：

- simulation Application 只依赖 `SecurityMetadataReader Port`，不依赖 Security Master storage；
- Security Master audit Application 只依赖 snapshot capability 与 resolver Port，不依赖 filesystem/Ledger；
- 主查询和 snapshot audit capability 分别断言，不互相扩大消费者依赖；
- `SecurityMasterQualityValidator` 不依赖 IO、Adapter、Port、MCP 或 simulation；
- MCP Tool 不读取 Security Master/Universe；
- Composition Root 才负责 `LedgerSecurityMasterReader -> LedgerSecurityMetadataReader` concrete wiring；
- `SecurityExecutionProfileResolver` 不依赖 Ledger/FS/DB；
- `LedgerSecurityMetadataReader` 不拥有证券分类规则，不访问文件系统；
- `LedgerSecurityMasterReader` 负责 repository IO，但不知道 execution profile id / ExecutionModel；
- Security Master 不包含 execution profile id；
- Security Master 数据源路径不能逃逸 `dataRoot`；
- 同一证券身份/执行资格的规范化只有一个权威实现。

对应测试：

```text
tests/security-master.test.js
tests/security-master-quality.test.js
tests/simulation-security-execution-profile-resolver.test.js
tests/simulation-execution-boundary.test.js
```

## 9. 本阶段验收

已经覆盖：

- Record schema 与日期、来源、质量字段规范化；
- A 股矛盾资格和无审计来源数据 fail closed；
- record set 派生记录；
- 显式逐证券记录优先级；
- `asOf` 有效期选择；
- 未知证券返回 `null`；
- `dataRoot` 路径逃逸保护；
- MetadataReader 仅做 SecurityMasterRecord 投影；
- 独立 snapshot audit capability；
- 重复记录、有效期重叠、资格冲突检测；
- manifest / referenced file integrity 失败进入结构化 audit error；
- Security Master facts 到 execution profile 的可解析性检查；
- validation CLI；
- CI quality gate；
- Architecture fitness 边界。

下一阶段不应再增加代码号段分类。优先建立 ETF Security Master 的**来源适配与同步流水线**：

```text
External/Repository Source Adapter
        ↓
Raw ETF facts
        ↓
Security Master Normalizer
        ↓
SecurityMasterRecord[]
        ↓
Quality Gate
        ↓
Repository manifest / records
```

来源适配负责 IO；事实规范化和冲突规则保持确定性；写入仓库之前必须先通过当前质量门禁。
