# 数据契约

> 日期：2026-06-30  
> 目标：定义数据、运行记录和质量报告的稳定格式。

## 1. Pool 文件

路径：

```text
data/pool/<YYYYMMDD>/<pool>.json
```

其中 `<pool>` 为：

```text
dt
qs
zb
zt
```

要求：

- JSON 可解析。
- `data.qdate` 应等于目录日期。
- `data.pool` 应为数组。
- 原始字段保持来源结构，避免在原始快照中写入本地运行动态字段。

## 2. Codes 文件

路径：

```text
data/pool/<YYYYMMDD>/codes.json
```

格式：

```json
{
  "fields": ["code"],
  "input_path": "data/pool/20260325",
  "file_count": 4,
  "total_records": 312,
  "total_codes": 300,
  "codes": ["000001", "000002"]
}
```

要求：

- `codes` 去重。
- `codes` 升序排序。
- 同样输入重复生成内容稳定。

## 3. Kline 文件

路径：

```text
data/kline/<period>/<prefix>/<code>.json
```

其中：

- `<period>` 为 `daily` 或 `yearly`。
- `<prefix>` 为股票代码前三位。
- `<code>` 为 6 位股票代码。

格式：

```json
{
  "code": "000007",
  "market": 0,
  "period": "daily",
  "klines": [
    "1992-04-13,1.87,2.02,2.16,1.87,319,3781000,56.86,296.08,1.51,0.38"
  ]
}
```

要求：

- `klines` 非空。
- 日期升序。
- 日期不重复。
- 每行字段数量稳定。
- 不写入 `source_engine`、`source_region`、`fetched_at`、`meta` 等运行动态字段。

## 4. Run Manifest

路径：

```text
runs/<run_id>/run.json
```

格式：

```json
{
  "run_id": "20260325T163000_daily",
  "type": "daily",
  "date": "20260325",
  "period": "daily",
  "engine": "auto",
  "input": "data/pool/20260325/codes.json",
  "status": "completed",
  "total": 10,
  "success": 10,
  "skipped": 0,
  "failed": 0,
  "started_at": "2026-03-25T16:30:00Z",
  "finished_at": "2026-03-25T16:35:00Z",
  "artifacts": {
    "pool_dir": "data/pool/20260325",
    "kline_dir": "data/kline/daily",
    "quality": "runs/20260325T163000_daily/quality.json",
    "failures": "runs/20260325T163000_daily/failures.json"
  }
}
```

`status` 取值：

```text
completed
completed_with_failures
failed
skipped
```

## 5. Failures

路径：

```text
runs/<run_id>/failures.json
```

格式：

```json
{
  "run_id": "20260325T163000_daily",
  "failed": 1,
  "items": [
    {
      "target": "1.600519",
      "code": "600519",
      "type": "kline",
      "period": "daily",
      "reason": "timeout",
      "retry_count": 0
    }
  ]
}
```

## 6. Quality

路径：

```text
runs/<run_id>/quality.json
```

格式：

```json
{
  "run_id": "20260325T163000_daily",
  "target": "data/kline/daily",
  "period": "daily",
  "total_files": 10,
  "issue_count": 0,
  "status": "ok",
  "issues": []
}
```

`status` 取值：

```text
ok
failed
recorded
```

## 7. Report 文件

路径：

```text
reports/<YYYYMMDD>/
```

后续格式：

```text
candidates.json
candidates.csv
summary.md
quality.json
```

MVP 不强制生成报告，但目录和命名保持该契约。

## 8. 历史证券主数据

模拟器不得使用 pool 派生的 `data/pool/<YYYYMMDD>/codes.json` 代表全市场。应建设按有效日期查询的沪深京 A 股证券主数据，包含后来退市股票。

建议逻辑记录：

```json
{
  "code": "600519",
  "market": 1,
  "exchange": "SSE",
  "board": "main",
  "name": "贵州茅台",
  "listed_date": "2001-08-27",
  "delisted_date": null,
  "effective_from": "2001-08-27",
  "effective_to": null,
  "source": "eastmoney_clist",
  "quality": "verified"
}
```

要求：

- 使用 `code + market` 作为仓库内部证券标识。
- 名称、板块、ST、*ST、退市整理等可变状态使用有效时间区间保存。
- 历史 Universe 查询返回模拟日期当时已上市且尚未退市的证券。
- 后来退市的股票仍必须出现在其历史有效区间内，避免幸存者偏差。
- 东方财富缺失的退市、状态或公司行为信息允许由交易所等公开来源补齐。
- 多来源字段记录来源、抓取时间、冲突状态和质量等级。

## 9. 双价格与公司行为

模拟器使用两个明确分离的价格视图：

- `raw`：不复权真实 OHLC，用于成交、现金、费用、涨跌停和持仓成本。
- `forward_point_in_time`：只使用模拟日期当时已经发生的公司行为计算，用于信号、日线、年线和 BOLL。

公司行为和复权因子至少包含：

```json
{
  "code": "600519",
  "market": 1,
  "ex_date": "2025-06-27",
  "type": "cash_dividend",
  "cash_per_share": 2.76,
  "factor": 0.9981,
  "known_at": "2025-06-27",
  "source": "exchange",
  "quality": "verified"
}
```

要求：

- 模拟日之后发生或才被知晓的公司行为不得改变模拟日的复权视图。
- 同一信号中的今日价格和历史基准使用相同因子版本。
- 当前年度年线由截至模拟日的日线聚合，不读取当前完整年度 K 线。
- 缺少不复权行情、真实前收盘、公司行为或必要因子时，正式会话数据预检失败。
- 现有 `data/kline/{daily,yearly}` 的前复权账本继续服务既有信号，但不能直接承担模拟成交账本。

## 10. 历史交易规则

历史规则使用有效日期版本化，至少覆盖：

- 交易所、板块和证券状态对应的涨跌停比例。
- 新股上市初期特殊规则。
- T+1、整手和零股卖出规则。
- 佣金最低收费、印花税和过户费。
- 停牌、ST、*ST 和退市整理状态。

每条规则必须包含 `effective_from`、`effective_to`、来源和版本。无法确定适用规则的日期不得静默套用当前规则。

## 11. 模拟会话数据版本

创建模拟会话时写入不可变数据清单：

```json
{
  "universe_version": "sha256:<hash>",
  "raw_kline_version": "sha256:<hash>",
  "corporate_action_version": "sha256:<hash>",
  "rule_version": "sha256:<hash>",
  "benchmark_version": "sha256:<hash>"
}
```

会话恢复、克隆和报告生成必须使用相同数据版本。后台数据刷新不得改变已开始会话的结果。

## 12. 模拟运行产物

模拟器使用 SQLite 保存会话、订单、成交、冻结资产、候选快照和只追加事件，并可导出到：

```text
runs/simulator/<session_id>/export/
```

导出要求：

- 普通匿名会话揭晓前不输出真实名称和代码。
- 随机盲测只能在完成或主动结束后生成实名复盘包。
- 候选别名在单个会话内稳定，不得跨独立会话提供可关联标识。
- 最终导出包含配置、数据版本、事件、订单、成交、每日账户快照和绩效报告。
