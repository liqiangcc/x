# ETF Security Master 同步设计

> 日期：2026-08-12  
> 状态：第一阶段已实现  
> 范围：ETF 官方来源边界、完整快照语义、事实规范化、质量门禁和 Security Master 持久化。本文不定义 ExecutionModel、投资策略或 MCP 协议。

## 1. 目标

建立以下可审计链路：

```text
Official Exchange Data
        ↓
EtfSecuritySource Port
        ↓
OfficialExchangeEtfSource
        ↓
ETF fact normalization
        ↓
SecurityMasterRecord[]
        ↓
existing Security Master Quality Gate
        ↓
SecurityMasterWriter Port
        ↓
Ledger record_file
        ↓
existing LedgerSecurityMasterReader
```

核心要求：

1. 不根据代码号段、基金名称或字符串中的 `ETF` 推断证券类型；
2. 不根据“跨境 / 黄金 / 债券”等名称自行推断 T+0；
3. `intradayRoundTripEligible=false` 只能由**完整 ETF 全集 + 完整 T+0 集合**的差集得到；
4. 任何分页不完整、下载失败、来源不可信或集合不一致都 fail closed；
5. 同步结果必须经过现有 Security Master Quality Gate 后才能写入仓库；
6. Application 不读写文件，Source Adapter 不写 Security Master，Writer 不决定证券分类。

## 2. 权威来源

### 2.1 上海证券交易所

官方 ETF / 基金页面：

```text
https://etf.sse.com.cn/fundlist/
https://www.sse.com.cn/assortment/fund/list/
```

上交所基金列表页面提供 ETF 列表，并提供“当日回转交易基金”筛选能力。2026 年修订的《上海证券交易所交易规则》第 3.1.5 条明确列出部分 ETF 品种实行当日回转交易。

规则用于解释制度语义，但 Security Master 的逐证券资格仍应由交易所证券清单/完整成员快照提供，而不是由本地代码把品种名称转换成资格。

### 2.2 深圳证券交易所

官方 ETF 页面：

```text
https://fund.szse.cn/marketdata/etf/
https://www.szse.cn/market/product/list/etfList/
```

深交所上市公告还会对部分 ETF 逐证券明确写明“实施当日回转交易”。这类公告可作为单证券正向资格证据和审计证据。

但是：

> 某一上市公告没有出现“T+0”文字，不等价于一个可复用的完整 `false` 数据集。

因此批量同步仍要求一个完整 T+0 membership snapshot 或等价的官方完整数据集，不能靠单公告缺少关键字推导负面事实。

## 3. 为什么当前不硬编码交易所内部 API

交易所公开网页由动态数据驱动，但公开页面本身并未把其内部 JSON/Excel 请求接口定义成稳定公共 API 契约。

本阶段因此采用：

```text
官方完整导出/快照
        ↓
稳定本地 snapshot contract
        ↓
OfficialExchangeEtfSource
```

而不是把从浏览器网络面板逆向得到的临时 `sqlId`、`catalogId` 或未公开查询参数直接写进 Domain/Application。

后续若确认某个交易所公开导出接口具有稳定、可测试的契约，可以新增 transport adapter：

```text
SseEtfSnapshotFetcher
SzseEtfSnapshotFetcher
```

它们只负责“下载并证明快照完整”，现有 Source Port、Normalizer、Quality Gate 和 Writer 不需要变化。

## 4. EtfSecuritySource Port

`src/ports/market/etf_security_source.js`

```text
fetchFacts() -> {
  exchange,
  records: SecurityMasterRecord[],
  summary,
  source
}
```

Port 不规定 HTTP、文件、Excel 或 JSON。

## 5. 完整快照契约

`OfficialExchangeEtfSource` 依赖两个独立快照：

```json
{
  "complete": true,
  "records": [],
  "source": {
    "document": "https://官方交易所/...",
    "version": "可审计版本",
    "collectedAt": "ISO-8601"
  }
}
```

### 5.1 allEtfs

每条记录至少包含：

```json
{
  "code": "510300",
  "listingDate": "2012-05-28"
}
```

也可使用 `effectiveFrom` 替代 `listingDate`。

### 5.2 t0Etfs

记录只需要稳定证券代码：

```json
{
  "code": "511010"
}
```

### 5.3 完整性约束

只有：

```text
allEtfs.complete = true
t0Etfs.complete  = true
```

才能执行：

```text
T0 = code ∈ t0Etfs
T1 = code ∈ allEtfs AND code ∉ t0Etfs
```

否则整个 source fetch 失败。

此外：

- T+0 code 必须是 ETF 全集的子集；
- 两个集合内部禁止重复 code；
- `source.document` 必须是对应交易所的 HTTPS 官方域名；
- SSE 只接受 `sse.com.cn` 及其子域；
- SZSE 只接受 `szse.cn` 及其子域。

## 6. ETF Fact Normalizer

`src/market/etf_security_fact_normalizer.js` 是纯确定性 Logic。

输入必须显式包含：

```text
exchange
security
intradayRoundTripEligible: boolean
effectiveFrom / effectiveTo
provenance
```

它只生成：

```text
SecurityMasterRecord
  instrumentType = etf
```

不得：

- 访问网络；
- 读取文件；
- 根据名称或 code 推断 ETF；
- 选择 execution profile；
- 构造 ExecutionModel。

## 7. 同步 Application

`SyncEtfSecurityMasterUseCase` 只做编排：

```text
EtfSecuritySource[]
        ↓
collect normalized records
        ↓
ValidateSecurityMasterUseCase
        ↓
validation.ok ?
   ├─ no  -> writes=[]
   └─ yes -> SecurityMasterWriter.writeRecords(...)
```

因此同步不会建立第二套质量规则。

## 8. record_file

ETF 逐证券记录数量可能很大，不应全部堆进 `manifest.json`。

Security Master 新增通用 record set：

```json
{
  "kind": "record_file",
  "path": "security_master/records/etf_sse.json"
}
```

记录文件：

```json
{
  "schemaVersion": 1,
  "datasetId": "etf_sse",
  "metadata": {},
  "records": []
}
```

`record_file` 是 Security Master 通用存储能力，不知道 ETF、T+0 或 ExecutionProfile。

`LedgerSecurityMasterWriter` 负责原子写入记录文件并注册 manifest；`LedgerSecurityMasterReader` 负责读取，现有质量审计会自动看到这些 records。

## 9. CLI

当前可复现入口：

```bash
node scripts/sync_etf_security_master.js \
  --exchange sse \
  --all-snapshot /path/to/sse-all-etfs.json \
  --t0-snapshot /path/to/sse-t0-etfs.json
```

SZSE 同理。

CLI 只做 concrete wiring：

```text
snapshot files
   ↓
OfficialExchangeEtfSource
   ↓
SyncEtfSecurityMasterUseCase
   ↓
LedgerSecurityMasterWriter
```

## 10. Architecture Fitness

持续保证：

- ETF fact normalizer 无 IO / protocol / Adapter 依赖；
- Source Adapter 不依赖 SecurityMasterWriter；
- Sync Application 只依赖 Source Port / Writer Port / Quality Application / Resolver Port；
- Sync Application 不依赖 Ledger 或 concrete exchange source；
- Writer 不依赖 execution profile / strategy / MCP；
- 不允许用 code/name heuristic 替代官方资格数据。

## 11. 下一阶段

下一步不是修改 Domain，而是实现或验证**官方快照 transport**：

```text
SSE public export transport
SZSE public export transport
        ↓
prove pagination/completeness
        ↓
produce snapshot contract
        ↓
existing pipeline
```

如果交易所官方页面没有稳定公开机器接口，优先把浏览器导出的官方 Excel/JSON 作为可审计 source snapshot 提交，再由当前 CLI 归一化；不要把未公开动态接口当成永久 API。
