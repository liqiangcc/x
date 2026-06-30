# 用户工作流

> 日期：2026-06-30  
> 目标：定义 `x` 重构后的主要使用流程、输入输出和失败处理。

## 1. 每日自动采集

触发方式：

```bash
x daily --latest --limit 10 --period daily --commit
```

步骤：

```text
解析最近交易日
拉取 dt/qs/zb/zt pool
生成 codes.json
同步 daily kline
执行 kline 质量检查
写 run.json / quality.json / failures.json
按需提交 data 和 runs
```

输出：

```text
data/pool/<date>/
data/kline/daily/<prefix>/<code>.json
runs/<run_id>/
```

失败处理：

- pool 某类失败时记录到 run manifest。
- kline 单只股票失败时记录到 `failures.json`。
- 质量检查失败时 `quality.json` 标记 `failed`。
- 允许任务以 `completed_with_failures` 完成，便于后续重试。

## 2. 指定日期补数据

触发方式：

```bash
x daily --date 20260325 --limit 10 --period daily
```

适用场景：

- 补某个历史交易日。
- 修复某日部分数据。
- 复盘某日信号。

验收：

- 输出目录日期与指定日期一致。
- `codes.json` 来自该日期 pool。
- `run.json` 中 `date` 字段为指定日期。

## 3. 单阶段手动执行

Pool：

```bash
x pool pull --date 20260325
```

Codes：

```bash
x codes build data/pool/20260325
```

Kline：

```bash
x kline sync data/pool/20260325 --period daily --limit 10
```

Validate：

```bash
x kline validate --period daily
```

这些命令用于排查问题或小步验证。正式自动化以 `x daily` 为入口。

## 4. 查看运行记录

查看最近运行：

```bash
x run list
```

查看单次运行：

```bash
x run show <run_id>
```

查看失败项：

```bash
x run failures <run_id>
```

运行记录目录：

```text
runs/<run_id>/run.json
runs/<run_id>/quality.json
runs/<run_id>/failures.json
```

## 5. 数据提交

查看可提交数据：

```bash
x git status-data --date 20260325
```

提交数据：

```bash
x git commit-data --run-id <run_id>
```

提交范围：

```text
data/
runs/
reports/
```

无变化时必须跳过提交。

## 6. 个股历史追踪

按 Git 历史追踪某只股票：

```bash
git log --oneline -- data/kline/daily/000/000007.json
```

目标是能定位：

- 文件何时创建。
- 文件何时更新。
- 对应哪次 `run_id`。
- 当时质量状态如何。

## 7. 后续日报流程

信号和报告阶段稳定后增加：

```bash
x report daily --date 20260325
```

输出：

```text
reports/20260325/candidates.json
reports/20260325/candidates.csv
reports/20260325/summary.md
reports/20260325/quality.json
```
