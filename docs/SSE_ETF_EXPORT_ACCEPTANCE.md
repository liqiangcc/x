# SSE ETF 官方导出兼容性验收

> 日期：2026-08-13  
> 状态：验收入口已实现；等待真实导出文件完成最终格式定型  
> 范围：只判断上交所 ETF 官方导出文件的真实格式、完整性证据与现有 Transport 兼容性，不修改 ETF 业务事实、Security Master、ExecutionProfile 或 MCP。

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

## 2. 2026-08-13 官方页面观察

重新检查上交所基金网站：

- `https://etf.sse.com.cn/fundlist/` 明确显示“导出Excel”；
- 同一页面提供“当日回转交易基金”筛选；
- 页面当前引用版本化脚本：`/xhtml/js/fundlist.js?v=V3.1.0_20260304`；
- 公开抓取环境可以确认页面与脚本版本，但不能稳定取得点击“导出Excel”后的实际下载 bytes；
- 因此本阶段不把按钮名称、扩展名或网页内部未公开 AJAX 当作文件格式/API contract。

这意味着当前正确动作不是直接加入 `xlsx` 依赖，而是先让真实文件可以被确定性地探测和验收。

## 3. Probe CLI

新增：

```bash
node scripts/probe_official_etf_export.js --input ~/Downloads/<official-export>
```

输出示例：

```json
{
  "filePath": "/.../download.xls",
  "byteLength": 123456,
  "contentHash": "sha256:...",
  "extensionHint": ".xls",
  "signature": "utf8_text",
  "transportSupported": true,
  "parserFormat": "html_table",
  "parserRecordCount": 1234,
  "parserError": null,
  "recommendation": "official_export_file"
}
```

如果希望真实导出必须已经能被当前 Transport 处理：

```bash
node scripts/probe_official_etf_export.js \
  --input ~/Downloads/<official-export> \
  --require-supported
```

不支持时退出码为 `2`。

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

如果网站把 HTML table 保存成 `.xls`，结果仍然是：

```text
extensionHint = .xls
signature = utf8_text
parserFormat = html_table
transportSupported = true
```

这种情况**不需要** XLS parser。

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

只标记：

```text
signature = ole_compound_file
recommendation = verified_xls_parser_required
```

Probe 不宣称 payload 一定是 Excel BIFF，因为 OLE compound file 还可承载其他格式。

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

## 5. 真实 SSE 导出验收流程

### Step A：从官方页面导出 ETF 全集

官方页面：

```text
https://etf.sse.com.cn/fundlist/
```

保留浏览器下载得到的原始文件，不要先另存为 CSV。

运行：

```bash
node scripts/probe_official_etf_export.js --input <raw-file>
```

记录：

```text
byteLength
contentHash
extensionHint
signature
transportSupported
parserFormat
parserRecordCount
recommendation
```

### Step B：导出“当日回转交易基金”完整筛选结果

在同一官方页面勾选“当日回转交易基金”，导出完整结果。

再次运行 Probe。

禁止用名称、代码前缀或产品类别本地推断 T+0 集合。

### Step C：核对官网记录数

对 `all_etfs` 与 `t0_etfs` 分别记录官网显示的总条数：

```text
expectedRecordCount
```

解析后的：

```text
parserRecordCount
```

必须与官网完整结果一致。

### Step D：选择 parser 路径

#### 如果当前 Transport 已支持

直接：

```bash
node scripts/capture_official_etf_snapshot.js ...
```

并锁定：

```text
expectedRecordCount
expectedContentHash
```

#### 如果是 xlsx_ooxml

下一步仅新增：

```text
VerifiedXlsxSnapshotTransport / parser
```

要求：

- 使用真实官方原始文件作为兼容性 evidence；
- parser 独立于 `OfficialExchangeEtfSource`；
- 不把 XLSX library 泄漏到 Source/Application；
- 解析出来仍是同一个 standard snapshot；
- 明确 worksheet/表头选择规则；
- 多 sheet、隐藏 sheet、shared strings、日期单元格必须有 fixture；
- 任何 schema 漂移 fail closed。

#### 如果是 ole_compound_file

先确认内部确实是 Excel BIFF，再新增 verified XLS parser。

禁止只因为扩展名 `.xls` 就引入 BIFF parser。

## 6. Fixture 原则

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
  "signature": "...",
  "capturedAt": "...",
  "notes": "..."
}
```

如果完整官方导出不适合直接进入仓库，则只提交经过批准的最小结构 fixture + 原始文件 hash/manifest，原始文件保留在外部审计位置。

## 7. Separation of Concerns

本阶段新增边界：

```text
raw file bytes
      ↓
OfficialExportProbe      ← deterministic diagnostics
      ↓
format evidence

CLI
 └─ owns filesystem IO
```

Probe 不允许依赖：

```text
SecurityMasterWriter
Quality Application
ExecutionProfile
BuyExecutionModel
MCP
HTTP
strategy/business policy
```

`OfficialExchangeEtfSource` 也不知道 Probe 是否存在。

因此未来即使增加：

```text
VerifiedXlsxSnapshotTransport
VerifiedXlsSnapshotTransport
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

## 8. 当前结论

截至 2026-08-13：

1. 官方页面确认存在“导出Excel”；
2. 官方页面确认存在“当日回转交易基金”筛选；
3. 页面脚本版本已经记录；
4. 尚未取得真实下载 bytes，因此没有证据证明导出一定是 XLS、XLSX、HTML 或 CSV；
5. 仓库现在已经具备真实文件到手后的确定性格式探测与 parser 路由能力；
6. 在真实 bytes 证明格式之前，不新增 Excel 解析依赖。
