# 技术设计

> 日期：2026-06-30  
> 目标：定义 `x` 的 MVP 技术实现方式和后续演进方向。

## 1. 架构方向

短期架构：

```text
bin/x
  -> fetch/pull_pool_task.js
  -> utils/parse_pool_json.js
  -> fetch/query_pool_klines.js
  -> fetch/check_kline_empty.js
  -> runs/<run_id>/*
  -> git commit
```

中长期架构：

```text
src/core/
src/sources/eastmoney/
src/runners/
src/pipelines/
src/quality/
src/signals/
src/reports/
src/git/
```

MVP 先保留现有脚本，新增统一 CLI 和运行记录层，避免过早大拆模块。

## 2. CLI 设计

推荐入口：

```bash
x doctor
x pool pull --latest
x pool pull --date 20260325
x codes build data/pool/20260325
x kline sync data/pool/20260325 --period daily --limit 10
x kline validate --period daily
x daily --latest --limit 10 --period daily --commit
x run list
x run show <run_id>
x run failures <run_id>
x git status-data --date 20260325
x git commit-data --run-id <run_id>
```

`bin/x` 初期是 Node.js 薄封装，负责：

- 参数解析。
- 调用现有脚本。
- 生成 run manifest。
- 标准化 failures 和 quality。
- 调用 Git 完成规范提交。

## 3. Daily Workflow

`x daily` 流程：

```text
生成 run_id
解析 date/latest
pull pool
build codes
sync kline
validate kline
write failures.json
write quality.json
write run.json
按需 commit-data
```

失败策略：

- pool 或 kline 局部失败时记录失败项。
- 如果有失败，run 状态为 `completed_with_failures`。
- 如果关键步骤无法继续，run 状态为 `failed`。

## 4. Kline Writer

kline 文件写入稳定结构：

```json
{
  "code": "000007",
  "market": 0,
  "period": "daily",
  "klines": []
}
```

写入路径：

```text
data/kline/<period>/<prefix>/<code>.json
```

运行动态信息写入 `run.json`，不写入每只股票数据文件。

## 5. Quality Gate

MVP 校验：

- 文件非空。
- JSON 可解析。
- kline 数组存在。
- kline 数组非空。
- 日期格式正确。
- 日期升序。
- 日期不重复。
- 每行字段数量至少包含日期和 OHLC。
- OHLC 可解析且 high/low 合理。
- volume 和 turnover 非负。

质量结果写入 `runs/<run_id>/quality.json`。

## 6. Git 提交设计

提交命令只处理：

```text
data/
runs/
reports/
```

无 diff 时跳过。

提交信息：

```text
data(daily): <date> update pool, codes and <period> kline

run_id: <run_id>
pool_date: <YYYYMMDD>
period: <daily|yearly|none>
engine: <auto|local|aws|node>
total: <N>
success: <N>
failed: <N>
skipped: <N>
quality: <ok|failed|recorded>
```

## 7. GitHub Actions

`ci.yml`：

- Node syntax check。
- Python compile check。
- Bash syntax check。
- CLI smoke test。

`daily-data-commit.yml`：

- 支持 `workflow_dispatch`。
- 支持 schedule。
- 执行 `bin/x daily ... --commit`。
- 配置 `contents: write`。
- 无 diff 跳过提交。

## 8. 后续模块化

最小闭环稳定后再抽出：

```text
src/core/date.js
src/core/secid.js
src/core/retry.js
src/sources/eastmoney/jsonp.js
src/sources/eastmoney/poolClient.js
src/sources/eastmoney/klineClient.js
src/runners/localKlineRunner.js
src/runners/awsLambdaKlineRunner.js
src/runners/autoKlineRunner.js
```

模块化必须保持现有 CLI 行为兼容。
