# Security Master 设计

> 日期：2026-08-12  
> 状态：实现中  
> 范围：证券身份、证券类型、交易资格事实及其可审计来源。本文不定义交易费用、滑点、成交时机、业务策略或 MCP 协议。

## 1. 目标

Security Master 解决的是“**证券是什么，以及在某个有效期内具备什么资格**”，而不是“如何成交”。

目标链路：

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

关注点保持独立：

- Security Master：事实与证据；
- SecurityMetadataReader：面向 Application 的窄投影；
- SecurityExecutionProfileResolver：事实到 profile id 的纯确定性映射；
- ExecutionProfile / ExecutionModel：市场执行假设与成交机制；
- Business Policy：为什么买、何时产生业务信号。

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

## 3. Repository Manifest

仓库使用 `data/security_master/manifest.json` 作为统一入口。

为了避免把当前 5534 只沪深 A 股复制成第二份静态证券清单，manifest 可以声明可审计的 record set：

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
      "qualityIssues": []
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
- 暴露原始 manifest/universe JSON 给 Application。

### 4.2 LedgerSecurityMasterReader

职责：

- 读取 repository Security Master manifest；
- 将受支持的 record set 和显式 records 归一化；
- 校验数据契约；
- 仅允许读取 `dataRoot` 内的相对路径；
- 缓存不可变 snapshot 的归一化结果。

缺失 Security Master 时返回无记录；损坏或违反契约的数据应暴露错误，而不是悄悄猜一个证券类型。

### 4.3 LedgerSecurityMetadataReader

只负责投影：

```text
SecurityMasterRecord
    -> instrumentType
    -> intradayRoundTripEligible
    -> effectiveFrom/effectiveTo
    -> source
    -> qualityIssues
```

它不再直接知道 `data/universe` 的结构。

## 5. 时间语义

Security Master 从第一版就保存 `effectiveFrom/effectiveTo`，但本阶段不把“执行资格在一个回测区间内变化”偷偷塞进现有单 profile 模拟器。

规则：

- `SecurityMasterReader` 支持显式 `asOf` 查询；
- 不传 `asOf` 时返回最新可用事实，用于保持当前 simulation auto-selection 语义；
- 历史模拟若未来需要精确处理区间内资格变化，应建立独立的 temporal execution-profile capability，让执行 profile 随交易日变化，而不是让 Application 在一次模拟开始前猜一个历史状态。

因此数据契约先具备时间能力，业务执行语义后续单独演进。

## 6. 扩展原则

新增跨境 ETF、黄金 ETF、债券 ETF 等时，优先顺序：

```text
新增/同步 Security Master 数据
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

## 7. Architecture Fitness

应持续保证：

- Application 只依赖 `SecurityMetadataReader Port`；
- MCP Tool 不读取 Security Master/Universe；
- `SecurityExecutionProfileResolver` 不依赖 Ledger/FS/DB；
- `LedgerSecurityMetadataReader` 不拥有证券分类规则；
- Security Master 不包含 execution profile id；
- Security Master 数据源路径不能逃逸 `dataRoot`；
- 同一证券事实的规范化只有一个权威实现。
