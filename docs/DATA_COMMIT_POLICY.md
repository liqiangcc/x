# 数据提交规范

> 日期：2026-06-30  
> 适用范围：`data/`、`runs/`、`reports/` 以及由 GitHub Actions 或人工运行脚本生成的数据提交。  
> 核心目标：让数据直接进入仓库，但保持可维护、可 diff、可追溯、可重跑。

## 1. 基本原则

`x` 采用 **Repo-as-Data-Ledger** 模式：

```text
Git 仓库 = 代码 + 数据 + 运行记录 + 报告 的统一账本
```

因此，数据可以提交到仓库，但必须满足下面原则：

1. **数据文件可 diff**：格式稳定、排序稳定、不要写入无意义动态字段。
2. **提交信息可读**：commit message 必须说明日期、类型、成功数、失败数、质量状态。
3. **运行记录可追溯**：每次批量任务必须有 `runs/<run_id>/run.json`。
4. **失败项可重试**：失败股票或失败 pool 必须写入 `failures.json`。
5. **报告可复盘**：每日候选和质量摘要必须放入 `reports/<date>/`。
6. **不提交临时和大型二进制产物**：数据库、缓存、日志、压缩包不作为常规数据提交。

## 2. 允许提交的目录

### 2.1 Pool 数据

```text
data/pool/<YYYYMMDD>/dt.json
data/pool/<YYYYMMDD>/qs.json
data/pool/<YYYYMMDD>/zb.json
data/pool/<YYYYMMDD>/zt.json
data/pool/<YYYYMMDD>/codes.json
```

说明：

- `dt.json`、`qs.json`、`zb.json`、`zt.json` 保存原始 pool 数据。
- `codes.json` 保存从 pool 数据提取出的去重股票代码。
- 同一个交易日目录中的文件应来自同一次或可追溯的运行。

### 2.2 Kline 数据

推荐结构：

```text
data/kline/daily/<prefix>/<code>.json
data/kline/yearly/<prefix>/<code>.json
```

示例：

```text
data/kline/daily/000/000007.json
data/kline/daily/002/002001.json
data/kline/daily/300/300001.json
data/kline/daily/600/600519.json
```

`<prefix>` 取股票代码前三位。这样可以避免几千个文件堆在同一个目录下。

### 2.3 运行记录

```text
runs/<run_id>/run.json
runs/<run_id>/failures.json
runs/<run_id>/quality.json
```

其中：

- `run.json` 是每次任务的机器可读记录。
- `failures.json` 是失败项和失败原因。
- `quality.json` 是质量检查结果。

### 2.4 报告

```text
reports/<YYYYMMDD>/candidates.csv
reports/<YYYYMMDD>/candidates.json
reports/<YYYYMMDD>/quality.json
reports/<YYYYMMDD>/summary.md
```

报告应面向人工复盘，尤其是 `summary.md`，应包含候选数量、信号摘要、质量结果和失败情况。

## 3. 不允许作为常规数据提交的内容

```text
node_modules/
*.log
*.tmp
*.db
*.sqlite
*.db-wal
*.db-shm
*.duckdb
*.duckdb.wal
*.zip
*.tar
*.tar.gz
.env
config/local.json
```

说明：

- SQLite / DuckDB 可以在本地或 CI 中生成，但不作为主数据源提交。
- 压缩包不适合作为常规数据格式，因为 diff 不友好。
- 日志如果需要保留，应压缩为摘要写入 `run.json` 或 `summary.md`，不要提交长日志。

## 4. 数据文件格式要求

### 4.1 必须 deterministic

同样输入重复运行，不应该产生无意义 diff。

要求：

```text
JSON 缩进固定为 2 spaces
字段顺序固定
数组排序固定
股票代码排序固定
Kline 日期升序
不要写入当前时间到数据文件
不要写入随机 callback 到数据文件
不要写入临时 source_region 到数据文件
```

### 4.2 数据和运行元信息分离

Kline 数据文件只保存研究需要的数据。

推荐：

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

不推荐在每个 kline 文件中写：

```json
{
  "source_engine": "aws",
  "source_region": "ap-northeast-1",
  "fetched_at": "2026-06-30T06:00:00Z"
}
```

这些运行信息应写入：

```text
runs/<run_id>/run.json
```

## 5. Run Manifest 规范

每次批量任务必须生成 `run.json`。

推荐字段：

```json
{
  "run_id": "20260325T163000_daily",
  "type": "kline_sync",
  "date": "20260325",
  "period": "daily",
  "engine": "auto",
  "input": "data/pool/20260325/codes.json",
  "status": "completed_with_failures",
  "total": 312,
  "success": 300,
  "skipped": 8,
  "failed": 4,
  "started_at": "2026-03-25T16:30:00Z",
  "finished_at": "2026-03-25T16:47:00Z",
  "artifacts": {
    "pool_dir": "data/pool/20260325",
    "kline_dir": "data/kline/daily",
    "quality": "runs/20260325T163000_daily/quality.json",
    "failures": "runs/20260325T163000_daily/failures.json"
  }
}
```

`status` 建议使用：

```text
completed
completed_with_failures
failed
skipped
```

## 6. Failures 规范

如果存在失败项，必须写入 `failures.json`。

示例：

```json
{
  "run_id": "20260325T163000_daily",
  "failed": 2,
  "items": [
    {
      "target": "0.000035",
      "code": "000035",
      "type": "kline",
      "period": "daily",
      "reason": "Local failed: timeout",
      "retry_count": 0
    },
    {
      "target": "1.600519",
      "code": "600519",
      "type": "kline",
      "period": "daily",
      "reason": "AWS failed: Lambda returned statusCode 500",
      "retry_count": 0
    }
  ]
}
```

后续应支持：

```bash
x run failures <run_id>
x run retry <run_id>
```

## 7. Quality 规范

每次数据提交前必须生成 `quality.json`。

示例：

```json
{
  "run_id": "20260325T163000_daily",
  "target": "data/kline/daily",
  "period": "daily",
  "total_files": 312,
  "issue_count": 0,
  "status": "ok",
  "issues": []
}
```

如果有问题：

```json
{
  "run_id": "20260325T163000_daily",
  "target": "data/kline/daily",
  "period": "daily",
  "total_files": 312,
  "issue_count": 2,
  "status": "failed",
  "issues": [
    {
      "file": "data/kline/daily/000/000035.json",
      "issue": "empty_klines",
      "code": "000035"
    }
  ]
}
```

## 8. Commit Message 规范

数据提交必须使用结构化提交信息。

格式：

```text
<type>(<scope>): <date> <summary>

run_id: <run_id>
pool_date: <YYYYMMDD>
period: <daily|yearly|none>
engine: <local|aws|auto|none>
total: <N>
success: <N>
failed: <N>
skipped: <N>
quality: <ok|failed|recorded>
```

### 8.1 Pool 提交

```text
data(pool): 20260325 add dt qs zb zt snapshots

run_id: 20260325T160000_pool
pool_date: 20260325
period: none
engine: node
total: 4
success: 4
failed: 0
skipped: 0
quality: ok
```

### 8.2 Codes 提交

```text
data(codes): 20260325 build 312 pool codes

run_id: 20260325T160500_codes
pool_date: 20260325
period: none
engine: node
total: 312
success: 312
failed: 0
skipped: 0
quality: ok
```

### 8.3 Kline 提交

```text
data(kline): 20260325 daily update 300/312 ok

run_id: 20260325T163000_daily
pool_date: 20260325
period: daily
engine: auto
total: 312
success: 300
failed: 12
skipped: 0
quality: failed
```

### 8.4 失败重试提交

```text
data(retry): 20260325 daily recover 10/12 failed klines

run_id: 20260325T171000_daily_retry
pool_date: 20260325
period: daily
engine: auto
total: 12
success: 10
failed: 2
skipped: 0
quality: failed
```

### 8.5 报告提交

```text
report(daily): 20260325 add 18 candidates

run_id: 20260325T173000_report
pool_date: 20260325
signals: limit_up_pool,year_breakout,volume_expand
candidates: 18
quality: ok
```

## 9. 推荐提交粒度

### 9.1 稳定后推荐拆分

```text
data(pool): 20260325 add dt qs zb zt snapshots
data(codes): 20260325 build 312 pool codes
data(kline): 20260325 daily update 300/312 ok
quality(kline): 20260325 record daily quality report
report(daily): 20260325 add 18 candidates
```

优点：

- Git log 更清晰。
- 每个阶段都可以单独回退。
- 更容易定位失败阶段。

### 9.2 初期可以合并

```text
data(daily): 20260325 update pool, codes and daily kline
```

但合并提交也必须包含：

```text
run_id
total
success
failed
quality
```

## 10. GitHub Actions 自动提交要求

自动提交 workflow 必须做到：

```text
1. checkout 时 fetch-depth: 0。
2. 配置 github-actions[bot] 用户。
3. 运行采集。
4. 运行质量检查。
5. 写 run.json。
6. 写 failures.json。
7. 写 quality.json。
8. git add data runs reports。
9. 如果没有 diff，则跳过 commit。
10. commit message 使用本规范。
11. git push。
```

建议 workflow 名称：

```text
.github/workflows/daily-data-commit.yml
```

## 11. `.gitignore` 建议

如果数据要进仓库，不应忽略 `data/`、`runs/`、`reports/`。

建议保留：

```text
data/**
runs/**
reports/**
```

建议忽略：

```gitignore
# temporary files
/tmp_*.json
*.tmp
*.log

# local env
.env
config/local.json

# local generated databases
*.db
*.sqlite
*.db-wal
*.db-shm
*.duckdb
*.duckdb.wal

# dependencies
node_modules/

# OS/editor
.DS_Store
.vscode/
.idea/
```

## 12. 数据提交前检查清单

提交前应检查：

```text
[ ] 是否有 run.json
[ ] 是否有 quality.json
[ ] 如果有失败，是否有 failures.json
[ ] commit message 是否包含 run_id
[ ] commit message 是否包含 total/success/failed/skipped
[ ] 数据文件是否 deterministic
[ ] 是否误提交了日志、数据库、压缩包、临时文件
[ ] 是否存在单个异常大文件
[ ] 是否一次性改动过多不相关文件
[ ] 报告和数据是否能从日期和 run_id 追溯
```

## 13. 推荐 Git 查询方式

按日期查询：

```bash
git log --grep "20260325"
```

按失败查询：

```bash
git log --grep "failed"
```

按数据类型查询：

```bash
git log --oneline -- data/pool
git log --oneline -- data/kline
git log --oneline -- reports
```

按个股查询：

```bash
git log --oneline -- data/kline/daily/000/000007.json
```

查看某次数据变化：

```bash
git show --stat <commit>
git show <commit> -- data/pool/20260325/codes.json
```

## 14. 当前优先落地事项

1. 调整 `.gitignore`，明确 `data/`、`runs/`、`reports/` 进入仓库。
2. 新增 `bin/x git commit-data`。
3. 新增 `runs/<run_id>/run.json` 生成逻辑。
4. 新增 `failures.json` 标准输出。
5. 新增 `quality.json` 标准输出。
6. 新增 `daily-data-commit.yml`。
7. 将 kline 输出迁移到 `data/kline/<period>/<prefix>/<code>.json`。
8. 把 kline 数据文件中的运行动态字段迁移到 run manifest。

## 15. 结论

数据可以直接提交到仓库，但必须让仓库成为有秩序的数据账本，而不是无规则的数据 dump。

正确形态是：

```text
数据文件可 diff
提交信息可维护
运行记录可追溯
失败项可重试
质量报告可审计
每日结果可复盘
```

只要遵守本规范，`x` 就可以在不依赖外部对象存储的前提下，用 GitHub Actions 自动维护完整的数据和研究结果历史。