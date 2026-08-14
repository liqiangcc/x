# SSE ETF 官方导出兼容性验收

> 日期：2026-08-13  
> 状态：真实导出格式已定型；Verified SSE XLS parser 已接入正式 capture 路径  
> 范围：只判断上交所 ETF 官方导出文件的真实格式、完整性证据与 Transport 兼容性，不修改 ETF 业务事实、Security Master、ExecutionProfile 或 MCP。

## 1. 目标

不能因为官网按钮写着“导出Excel”，就直接假定响应一定是 XLS 或 XLSX。

真实验收必须基于下载后的 **bytes**：

```text
official SSE export bytes
        ↓
format/signature probe
        ↓
existing transport supported?
        ├─ yes → capture snapshot
        └─ no  → choose exactly one verified parser path
```

文件扩展名只作为 hint，不能作为格式事实。

## 2. 2026-08-13 官方页面与真实导出证据

上交所 ETF 基金列表页：

```text
https://etf.sse.com.cn/fundlist/
```

已经通过受控 GitHub Actions discovery 获取并保存页面、controller、API 定义和真实导出响应证据。

页面事实：

- 页面明确显示“导出Excel”；
- 同一页面提供“当日回转交易基金”筛选；
- `SWING_TRADE` 官方筛选值为 `是`；
- 页面懒加载 `/xhtml/js/fundlist.js?v=V3.1.0_20260304`；
- 页面加载 `/xhtml/js/api.js?v=V202103-01`；
- ETF 根分类参数为 `CATEGORY=F100`。

官方 API contract 已从官方前端代码和真实请求中确认：

```text
list:
https://query.sse.com.cn/commonQuery.do?isPagination=true&sqlId=COMMON_JJZWZ_JJLB_L

non-paged list:
https://query.sse.com.cn/commonQuery.do?sqlId=COMMON_JJZWZ_JJLB_L

current export:
https://query.sse.com.cn/commonExcelDd.do
```

全集导出参数核心为：

```text
isPagination=false
sqlId=COMMON_JJZWZ_JJLB_L
CATEGORY=F100
SWING_TRADE=
type=inParams
```

T+0 导出只在同一官方 contract 上增加：

```text
SWING_TRADE=是
```

真实数据规模：

```text
all_etfs = 917
t0_etfs  = 192
```

真实响应均为：

```text
HTTP 200
Content-Type: application/vnd.ms-excel;charset=gb2312
Content-Disposition: attachment; filename=fundDataList.xls
signature: ole_compound_file
```

因此已经确认当前 SSE 导出不是 OOXML `.xlsx`，而是 OLE Compound File 内的 legacy Excel BIFF workbook。

2026-08-13 验收时记录的原始文件证据：

```text
all_etfs
  byteLength: 182272
  sha256: 45bbb54598ba6a50af143b096a79fecae693b84cfe24d41f8fb7ae81da65b339

t0_etfs
  byteLength: 43008
  sha256: b6914ae1fd6099fc80aa5cba20d37ea698b5592a152b428aa05ccee413423fe5
```

这些 hash 是一次验收 capture 的审计证据，不应被误解为永久不变的数据版本。

## 3. Probe CLI

```bash
node scripts/probe_official_etf_export.js --input ~/Downloads/<official-export>
```

Probe 输出：

```json
{
  "filePath": "/.../download.xls",
  "byteLength": 123456,
  "contentHash": "sha256:...",
  "extensionHint": ".xls",
  "signature": "ole_compound_file",
  "transportSupported": false,
  "parserFormat": null,
  "parserRecordCount": null,
  "parserError": null,
  "recommendation": "verified_xls_parser_required"
}
```

Probe 的职责仍只是 bytes → format evidence。它不会因为仓库已经实现 Verified XLS parser 就把格式识别和 parser selection 混成一个模块。

## 4. 文件签名判定

Probe 优先读取 bytes，不信任扩展名。

### 4.1 UTF-8 text

```text
signature = utf8_text
```

随后继续调用现有 `detectAndParse()` 判断：

```text
json
csv
tsv
html_table
```

如果网站把 HTML table 保存成 `.xls`，结果仍然按文本处理，不会误走 BIFF parser。

### 4.2 OOXML workbook

只有同时看到：

```text
ZIP signature
[Content_Types].xml
xl/workbook.xml 或 xl/workbook.bin
```

才标记：

```text
signature = xlsx_ooxml
recommendation = verified_xlsx_parser_required
```

不能因为文件名叫 `.xlsx` 就得到这个结论。

### 4.3 OLE compound file

检测到：

```text
D0 CF 11 E0 A1 B1 1A E1
```

Probe 标记：

```text
signature = ole_compound_file
recommendation = verified_xls_parser_required
```

真实 SSE 文件随后又通过 workbook parser 验证为 Excel BIFF，因此仓库才新增 Verified SSE XLS parser。

### 4.4 Generic ZIP

ZIP 但没有 OOXML workbook evidence：

```text
signature = zip_container
recommendation = unsupported_zip_container
```

不会把任意 ZIP 误当 XLSX。

### 4.5 Unknown binary

无法证明为 UTF-8、OOXML、ZIP 或 OLE：

```text
signature = binary_unknown
recommendation = unsupported_binary_format
```

保持 fail closed。

## 5. Verified SSE XLS contract

真实 workbook shape 已验证：

```text
sheet name: 基金列表
columns: 7
```

精确表头：

```text
基金代码
基金简称
基金扩位简称
标的指数
上市日期
最新规模(亿元)
基金管理人
```

真实 workbook 行数：

```text
all_etfs: A1:G918 = header + 917 records
t0_etfs:  A1:G193 = header + 192 records
```

仓库实现：

```text
VerifiedXlsSnapshotTransport
  ↓
SheetJS 0.20.3 (pinned)
  ↓
exact sheet/header/column validation
  ↓
standard snapshot
```

Parser 约束：

- 只接受 `exchange=sse`；
- 输入必须是真实 OLE Compound File bytes；
- SheetJS 必须精确为 `0.20.3`；
- workbook 必须只有一个名为 `基金列表` 的 sheet；
- 表头必须与上述 7 列完全一致；
- 数据行最多 7 列；
- 基金代码必须是明确六位数字；
- 任一 schema 漂移立即 fail closed。

正式 capture 不直接 import concrete XLS parser，而是：

```text
capture CLI
   ↓
OfficialSnapshotTransportResolver
   ↓ inspect bytes signature
   ├─ OLE + SSE → VerifiedXlsSnapshotTransport
   └─ supported text/JSON → OfficialExportFileTransport
```

因此 concrete format selection 只存在于 resolver/composition boundary。

## 6. 正式 capture 流程

全集：

```bash
node scripts/capture_official_etf_snapshot.js \
  --exchange sse \
  --dataset all_etfs \
  --input <official-all-etfs.xls> \
  --document https://etf.sse.com.cn/fundlist/ \
  --version <version> \
  --collected-at <ISO_DATETIME> \
  --expected-record-count 917 \
  --expected-content-hash sha256:<hash> \
  --output <snapshot.json>
```

T+0：

```bash
node scripts/capture_official_etf_snapshot.js \
  --exchange sse \
  --dataset t0_etfs \
  --input <official-t0-etfs.xls> \
  --document https://etf.sse.com.cn/fundlist/ \
  --version <version> \
  --collected-at <ISO_DATETIME> \
  --expected-record-count 192 \
  --expected-content-hash sha256:<hash> \
  --output <snapshot.json>
```

`expectedRecordCount` 与 `expectedContentHash` 必须来自同一次官方 capture evidence，不能把 2026-08-13 的值永久硬编码进业务逻辑。

## 7. Fixture 原则

真实官方 fixture 用于证明**格式兼容性**，不是作为永久 Security Master 数据源。

建议保存：

```text
tests/fixtures/official/sse/
  README.md
  <minimal-real-structure-fixture-or-approved-sample>
  manifest.json
```

manifest 至少包含：

```json
{
  "document": "https://etf.sse.com.cn/fundlist/",
  "observedPageScript": "/xhtml/js/fundlist.js?v=V3.1.0_20260304",
  "contentHash": "sha256:...",
  "byteLength": 0,
  "signature": "ole_compound_file",
  "capturedAt": "...",
  "notes": "..."
}
```

如果完整官方导出不适合直接进入仓库，则只提交经过批准的最小结构 fixture + 原始文件 hash/manifest，原始文件保留在外部审计位置。

## 8. Separation of Concerns

当前边界：

```text
raw file bytes
      ↓
OfficialExportProbe      ← deterministic diagnostics
      ↓
format evidence

Capture CLI
      ↓
OfficialSnapshotTransportResolver
      ├─ generic file transport
      └─ verified SSE XLS transport
      ↓
standard snapshot
      ↓
OfficialExchangeEtfSource
      ↓
Security Master Quality Gate
```

Probe 不依赖：

```text
SecurityMasterWriter
Quality Application
ExecutionProfile
BuyExecutionModel
MCP
HTTP
strategy/business policy
```

`OfficialExchangeEtfSource` 不知道：

```text
XLS
SheetJS
filesystem path
OfficialSnapshotTransportResolver
```

因此以后即使增加：

```text
VerifiedXlsxSnapshotTransport
VerifiedSzseXlsSnapshotTransport
OfficialHttpSnapshotTransport
```

也不会改变后面的：

```text
OfficialExchangeEtfSource
Security Master Quality Gate
SecurityMasterWriter
simulation
MCP
```

## 9. 当前结论

截至 2026-08-13：

1. 已确认 SSE 官方基金列表页面、controller 和 API contract；
2. 已确认 ETF 根分类 `CATEGORY=F100`；
3. 已确认官方 T+0 筛选参数为 `SWING_TRADE=是`；
4. 已取得真实全集和 T+0 下载 bytes；
5. 当前真实全集为 917 条，T+0 集合为 192 条；
6. 两个真实导出均确认为 OLE legacy XLS，而非 XLSX/HTML/CSV；
7. 已锁定 `基金列表` 单 sheet 与 7 列 schema；
8. 已固定使用 SheetJS 0.20.3 的 Verified SSE XLS parser；
9. 已通过 bytes-based resolver 将该 parser 接入正式 capture CLI；
10. generic transport、ETF Source、Security Master 和 simulation 均未承担 XLS/SSE parser 细节；
11. 下一阶段应先把同一次真实 all/T0 capture 转成标准 snapshots，并对现有同步链路做 dry-run Quality Gate，再决定是否持久化真实 `etf_sse` Security Master records。
