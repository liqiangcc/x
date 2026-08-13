# ETF Security Master 同步设计

> 日期：2026-08-13  
> 状态：SSE 真实官方导出、dry-run 与 guarded apply 已验证  
> 范围：ETF 官方来源边界、完整快照语义、事实规范化、质量门禁、受控持久化。本文不定义投资策略或 MCP 协议。

## 1. 目标

建立以下可审计链路：

```text
Official Exchange Data
        ↓
EtfSnapshotTransport
        ↓
OfficialExchangeEtfSource
        ↓
ETF fact normalization
        ↓
SecurityMasterRecord[]
        ↓
Security Master Quality Gate
        ↓
SecurityMasterWriter Port
        ↓
DryRun Writer / Ledger Writer
        ↓
LedgerSecurityMasterReader
        ↓
post-write Quality Gate
```

核心要求：

1. 不根据代码号段、基金名称或字符串中的 `ETF` 推断证券类型；
2. 不根据“跨境 / 黄金 / 债券”等名称自行推断 T+0；
3. `intradayRoundTripEligible=false` 只能由**完整 ETF 全集 + 完整 T+0 集合**的差集得到；
4. 任何分页不完整、下载失败、来源不可信、schema 漂移或集合不一致都 fail closed；
5. 同步结果必须先经过现有 Security Master Quality Gate；
6. 默认执行永远是 dry-run，只有显式 `--apply` 且 accepted count/hash guard 精确匹配才允许持久化；
7. apply 后必须重新读取持久化 ledger，并再次执行同一套 Security Master Quality Gate；
8. Application 不读写文件，Source Adapter 不写 Security Master，Writer 不决定证券分类。

## 2. 权威来源

### 2.1 上海证券交易所

官方 ETF / 基金页面：

```text
https://etf.sse.com.cn/fundlist/
https://www.sse.com.cn/assortment/fund/list/
```

真实验收已经确认页面的 ETF 根分类为 `CATEGORY=F100`，当日回转筛选为 `SWING_TRADE=是`。逐证券资格来自完整官方 membership snapshot，而不是本地根据基金名称推断。

当前受控采集使用已验证的官方查询/导出契约：

```text
list:
https://query.sse.com.cn/commonQuery.do
sqlId=COMMON_JJZWZ_JJLB_L

export:
https://query.sse.com.cn/commonExcelDd.do

ETF:
CATEGORY=F100

T+0:
SWING_TRADE=是
```

2026-08-13 的真实验收结果为 ETF 全集 917 条、T+0 192 条。导出响应为 OLE Compound File / legacy XLS，单 sheet `基金列表`，固定 7 列 schema。数量并不作为代码常量；每次 workflow 都以当次官方 list total 和 export hash 作为 acceptance evidence。

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

## 3. Transport 与 Source 分离

交易所网页、HTTP 参数、XLS/CSV/JSON 都属于 Transport concern，不属于 Security Master 事实模型。

```text
Official export bytes
        ↓
OfficialSnapshotTransportResolver
        ↓
VerifiedXlsSnapshotTransport / OfficialExportFileTransport
        ↓
standard snapshot contract
        ↓
OfficialExchangeEtfSource
```

SSE 当前真实导出已经验证为 legacy XLS，因此由 `VerifiedXlsSnapshotTransport` 处理；文本/JSON 导出仍由 generic transport 处理。Transport 只负责：

- 官方 provenance；
- byte signature；
- schema；
- expectedRecordCount；
- SHA-256；
- 标准 snapshot 输出。

`OfficialExchangeEtfSource` 不知道 XLS、SheetJS、HTTP endpoint 或文件扩展名。

页面/controller discovery 仅用于诊断和审计，不再作为正式同步的硬前置。2026-08-13 的 GitHub runner 曾对 `etf.sse.com.cn/fundlist/` 返回 403，而 `query.sse.com.cn` 的正式 list/export 仍可用，因此 acceptance hard gate 只依赖已经验证的 official category + list/export + verified parser。

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
    "collectedAt": "ISO-8601",
    "contentHash": "sha256:..."
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
- SZSE 只接受 `szse.cn` 及其子域；
- apply 模式要求 snapshot 的 `source.contentHash` 与 accepted dry-run guard 完全一致。

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

因此 dry-run 和 apply 不建立第二套质量规则。二者使用**完全相同的 Application**，只在 composition/control boundary 注入不同 Writer。

## 8. record_file

ETF 逐证券记录数量可能很大，不应全部堆进 `manifest.json`。

Security Master 使用通用 record set：

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

## 9. 默认 dry-run 与显式 apply

### 9.1 默认 dry-run

不传任何写入开关：

```bash
node scripts/sync_etf_security_master.js \
  --exchange sse \
  --all-snapshot /path/to/sse-all-etfs.json \
  --t0-snapshot /path/to/sse-t0-etfs.json
```

默认注入：

```text
DryRunSecurityMasterWriter
```

它执行真实 Source → Quality Gate → Writer Port 调用，但只返回 write intent，不创建或修改 `data/security_master`。`--dry-run` 仍保留为显式 alias。

### 9.2 `--apply` 必须带 acceptance guard

```bash
node scripts/sync_etf_security_master.js \
  --exchange sse \
  --all-snapshot /path/to/sse-all-etfs.json \
  --t0-snapshot /path/to/sse-t0-etfs.json \
  --apply \
  --expected-etf-count 917 \
  --expected-t0-count 192 \
  --expected-all-content-hash sha256:... \
  --expected-t0-content-hash sha256:...
```

四个 guard 缺任意一个都 fail closed。apply 前比较：

```text
accepted ETF count        == current all snapshot count
accepted T+0 count        == current T+0 snapshot count
accepted all content hash == current all snapshot hash
accepted T+0 content hash == current T+0 snapshot hash
```

任何一个变化都拒绝写入。因此 apply 只能消费一组已经被 dry-run/acceptance 接受过的精确 snapshot，而不能在审核后静默换成另一份数据。

### 9.3 写后重新验证

显式 apply 成功写入后：

```text
LedgerSecurityMasterWriter
        ↓
LedgerSecurityMasterReader
        ↓
ValidateSecurityMasterUseCase
        ↓
postWriteValidation.ok
```

写前和写后使用同一套 Quality Gate + SecurityExecutionProfileResolver。CLI 最终 `ok` 必须同时满足 pre-write validation 和 post-write validation。

## 10. 真实 SSE acceptance

`SSE ETF Export Discovery` workflow 当前执行：

```text
official list/export
        ↓
verified XLS capture
        ↓
default dry-run
        ↓
assert repository data/security_master unchanged
        ↓
copy repository data -> isolated staging root
        ↓
--apply + exact count/hash guards
        ↓
assert staged etf_sse.json + manifest entry
        ↓
post-write full ledger validation
        ↓
assert repository data/security_master still unchanged
```

这样可以真实证明 apply 行为，又不会让 acceptance workflow 自己成为自动写仓库的通道。

## 11. Architecture Fitness

持续保证：

- ETF fact normalizer 无 IO / protocol / Adapter 依赖；
- Source Adapter 不依赖 SecurityMasterWriter；
- Sync Application 只依赖 Source Port / Writer Port / Quality Application / Resolver Port；
- Sync Application 不依赖 Ledger 或 concrete exchange source；
- dry-run/apply 模式选择只存在于 CLI/composition boundary；
- Writer 不依赖 execution profile / strategy / MCP；
- apply guard 不改变 ETF 分类或交易规则；
- 不允许用 code/name heuristic 替代官方资格数据；
- 页面 discovery 失败不能绕过正式 list/export acceptance，也不能错误阻断已经验证的 transport contract。

## 12. 后续范围

SSE 的真实 transport、dry-run 和 guarded apply 已验证。下一步若要把真实 `etf_sse` 数据提交到功能分支，应使用已经验收的 snapshot 执行一次显式 guarded apply，提交：

```text
data/security_master/records/etf_sse.json
data/security_master/manifest.json
```

提交后必须让仓库 CI 再执行一次完整 `validate_security_master`。这一步属于**数据发布**，不再需要修改 Domain、Source、Transport 或 ExecutionProfile 架构。

SZSE 仍应沿用相同流程：先取得完整官方 ETF/T+0 snapshot contract，再接现有 Transport → Source → Quality Gate → default dry-run → guarded apply 链路。
