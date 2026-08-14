# ETF 官方快照 Transport 设计

> 日期：2026-08-13  
> 状态：已实现第一阶段（官方导出文件 Transport）  
> 范围：把交易所官方完整导出文件转换成标准 ETF snapshot。本文不定义 Security Master 写入、T+0 业务推断、ExecutionProfile 或模拟策略。

## 1. 背景

现有 ETF Security Master 同步链路已经有稳定边界：

```text
standard ETF snapshots
        ↓
OfficialExchangeEtfSource
        ↓
SecurityMasterRecord[]
        ↓
Security Master Quality Gate
        ↓
SecurityMasterWriter
```

缺口在 snapshot 前面：官方数据如何进入标准 snapshot。

2026-08-13 对公开官网重新验证后：

- 上交所 ETF/基金列表页面公开提供基金列表、当日回转交易基金筛选，并显示“导出 Excel”；
- 上交所公开页面可以作为来源 document 与记录数证据；
- 深交所公开提供 ETF 产品目录，但未确认一个稳定、公开、可长期依赖并同时证明 ETF 全集与 T+0 全集的 HTTP API；
- 当前没有把网页内部 AJAX、临时 query 参数或未公开接口当成稳定 API contract。

因此第一阶段选择 **official export file transport**，而不是猜测网页内部接口。

## 2. 新边界

```text
Official exchange page/export
        ↓
EtfSnapshotTransport Port
        ↓
OfficialExportFileTransport
        ↓
standard snapshot
        ↓
OfficialExchangeEtfSource
```

`EtfSnapshotTransport` 只有一个能力：

```text
readSnapshot() -> StandardSnapshot
```

Transport 不知道：

- SecurityMasterRecord；
- SecurityMasterWriter；
- Security Master Quality Gate；
- execution profile；
- fee/slippage/settlement；
- drawdown strategy；
- MCP。

## 3. Standard Snapshot

输出继续复用现有 Source contract：

```json
{
  "complete": true,
  "records": [],
  "source": {
    "document": "https://...official exchange...",
    "version": "20260813",
    "collectedAt": "2026-08-13T02:00:00.000Z",
    "contentHash": "sha256:..."
  },
  "transport": {
    "kind": "official_export_file",
    "exchange": "sse",
    "dataset": "all_etfs",
    "format": "csv",
    "expectedRecordCount": 1000,
    "actualRecordCount": 1000,
    "contentHash": "sha256:..."
  }
}
```

`OfficialExchangeEtfSource` 只需要 `complete / records / source`；`transport` 是审计信息，不进入业务事实。

原始文件 content hash 会通过 Source result 的 metadata evidence 继续传给 Ledger writer，用于审计输入身份，但不会污染 `SecurityMasterRecord` 的稳定事实契约。

## 4. 完整性证明

不能因为一个请求“成功返回”就把 snapshot 标成 complete。

第一阶段要求：

1. 来源 URL 必须是对应交易所官方 HTTPS 域名；
2. 操作者从官方完整列表/完整筛选结果执行导出；
3. 捕获时提供官网显示的 `expectedRecordCount`；
4. Transport 实际解析后的行数必须严格等于 expected count；
5. Transport 对原始 bytes 计算 SHA-256；
6. 可选传入 expected SHA-256，若不一致直接失败；
7. 任一记录无法提取六位证券代码时失败；
8. `all_etfs` 每条记录必须有明确上市日期；
9. 所有错误都 fail closed，不输出 `complete=true` snapshot。

这不能证明交易所网页自身没有业务错误，但能证明“本地导入的文件就是某次完整官方导出的那一份内容”。

## 5. 格式支持

当前 verified file transport 支持：

```text
JSON
UTF-8 CSV
UTF-8 TSV
HTML table
```

HTML table 支持的原因是部分传统“Excel 导出”实际返回 Excel 可打开的 HTML 表格。

当前**明确拒绝**：

```text
binary XLS
binary XLSX / ZIP OOXML
```

原因不是技术上不能解析，而是本阶段不为了“看起来自动化”引入未经验证的二进制 Excel parser 或手写 ZIP/XLS parser。

如果实际官方导出是二进制 XLS/XLSX，有两个安全路径：

1. 将官方导出另存为 UTF-8 CSV，再通过现有 Transport；
2. 后续新增独立的、经过 fixture/版本验证的 XLS/XLSX parser transport。

禁止静默降级、乱码猜列或把解析失败当空列表。

## 6. 字段提取

Transport 只提取 Source 层需要的显式字段：

### all_etfs

```text
基金代码 / 证券代码 / code
上市日期 / listingDate / effectiveFrom
```

输出：

```json
{
  "code": "510300",
  "listingDate": "2012-05-28"
}
```

### t0_etfs

只需要明确的证券代码：

```json
{
  "code": "511010"
}
```

Transport **不产生** `intradayRoundTripEligible`。

资格语义仍由：

```text
code ∈ complete T+0 snapshot
```

在 `OfficialExchangeEtfSource` 中完成。

因此不会出现：

```text
if name contains("黄金") -> T+0
if code startsWith("51") -> ETF
```

## 7. Capture CLI

新增：

```text
scripts/capture_official_etf_snapshot.js
```

示例：

```bash
node scripts/capture_official_etf_snapshot.js \
  --exchange sse \
  --dataset all_etfs \
  --input /tmp/sse-all.csv \
  --document https://etf.sse.com.cn/fundlist/ \
  --version 20260813 \
  --collected-at 2026-08-13T02:00:00Z \
  --expected-record-count 1234 \
  --output /tmp/sse-all.snapshot.json
```

T+0 snapshot 同理：

```bash
node scripts/capture_official_etf_snapshot.js \
  --exchange sse \
  --dataset t0_etfs \
  --input /tmp/sse-t0.csv \
  --document https://www.sse.com.cn/assortment/fund/list/ \
  --version 20260813-t0 \
  --collected-at 2026-08-13T02:05:00Z \
  --expected-record-count 80 \
  --output /tmp/sse-t0.snapshot.json
```

然后继续复用现有同步入口：

```bash
node scripts/sync_etf_security_master.js \
  --exchange sse \
  --all-snapshot /tmp/sse-all.snapshot.json \
  --t0-snapshot /tmp/sse-t0.snapshot.json
```

## 8. Architecture Fitness

测试锁定：

- Transport 可以依赖 filesystem/crypto；
- Transport 只能依赖纯 provenance Logic 与 Transport Port；
- Transport 不依赖 SecurityMasterWriter / Ledger / Quality Application；
- Transport 不依赖 simulation / ExecutionModel / MCP；
- `OfficialExchangeEtfSource` 不依赖具体 file transport；
- Source 不知道 CSV/XLSX/filePath；
- T+0 不由名称或代码前缀推断；
- 二进制 Excel 未支持时必须 fail closed。

对应：

```text
tests/official-etf-snapshot-transport.test.js
tests/official-etf-snapshot-transport-boundary.test.js
```

## 9. 后续 HTTP Transport

未来只有在满足以下条件时才新增自动 HTTP Transport：

1. 接口属于交易所官方域名；
2. 请求参数可以从公开页面/公开文档稳定确认；
3. 支持明确分页，并能证明抓取到了全部页；
4. 能得到总记录数或其他完整性证据；
5. T+0 数据是官方全集或明确逐证券资格，而不是本地分类推断；
6. 响应 schema 有 fixture 和兼容性测试；
7. 接口变化时 fail closed。

届时结构只变成：

```text
EtfSnapshotTransport Port
    ├─ OfficialExportFileTransport
    └─ OfficialHttpSnapshotTransport
```

`OfficialExchangeEtfSource`、Quality Gate、Security Master Writer 和 simulation 均无需修改。
