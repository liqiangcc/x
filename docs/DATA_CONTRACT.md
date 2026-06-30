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
