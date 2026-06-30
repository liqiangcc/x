# 可执行重构计划

> 日期：2026-06-30  
> 目标：把 `x` 按 Repo-as-Data-Ledger 方向分阶段落地。

## Phase 0：文档冻结

目标：明确业务目标、工作流、数据契约和技术方案。

任务：

- 新增产品需求说明。
- 新增用户工作流。
- 新增数据契约。
- 新增技术设计。
- 保持 `DATA_COMMIT_POLICY.md` 为提交规范来源。

验收：

- 能明确 MVP 做什么和不做什么。
- 能明确数据文件、运行记录和质量报告格式。
- 能明确数据如何进入 Git。

## Phase 1：统一 CLI

目标：用 `bin/x` 作为唯一推荐入口。

任务：

- 实现 `x doctor`。
- 实现 pool、codes、kline、daily、run、git 子命令。
- 初期只封装现有 Node 脚本。

验收：

```bash
bin/x doctor
bin/x daily --latest --limit 10 --period daily
```

## Phase 2：Run Manifest 和 Quality

目标：每次运行都可追溯、可审计。

任务：

- 生成 `runs/<run_id>/run.json`。
- 生成 `runs/<run_id>/quality.json`。
- 有失败时生成 `runs/<run_id>/failures.json`。
- 标准化 `total/success/skipped/failed/status`。

验收：

- `x daily` 后能通过 `x run show <run_id>` 查看运行记录。
- 失败项能通过 `x run failures <run_id>` 查看。

## Phase 3：数据提交命令

目标：本地和 GitHub Actions 使用同一提交规则。

任务：

- 实现 `x git status-data`。
- 实现 `x git commit-data --run-id <run_id>`。
- 无 diff 时跳过提交。
- commit message 符合 `DATA_COMMIT_POLICY.md`。

验收：

```bash
bin/x daily --latest --limit 10 --period daily --commit
```

## Phase 4：Kline 分片和稳定写入

目标：减少无意义 diff，避免单目录文件过多。

任务：

- 写入 `data/kline/<period>/<prefix>/<code>.json`。
- kline 数据文件只保存稳定研究数据。
- 运行动态信息进入 `run.json`。

验收：

- 同样输入重复运行无无意义 diff。
- 个股可通过 Git 路径精确追踪。

## Phase 5：GitHub Actions

目标：支持自动采集和自动提交。

任务：

- 新增 CI workflow。
- 新增 daily data commit workflow。
- workflow 支持手动输入 date、period、limit、engine。
- 配置自动提交和无 diff 跳过。

验收：

- 手动触发 workflow 能生成数据提交。
- 无变化时 workflow 不提交。

## Phase 6：模块化 Node 主线

目标：把脚本核心逻辑逐步抽成可测试模块。

任务：

- 抽出日期、secid、retry、JSONP、pool client、kline client。
- 抽出 Local/AWS/Auto runner。
- 保持旧脚本兼容。

验收：

```bash
node --check fetch/fetch_kline.js
node --check fetch/query_pool_klines.js
bin/x daily --latest --limit 10 --period daily
```

## Phase 7：信号和报告

目标：让仓库产出每日候选股票报告。

任务：

- 实现 limit_up_pool 信号。
- 实现 year_breakout 信号。
- 实现 volume_expand 信号。
- 输出 candidates JSON/CSV 和 summary Markdown。

验收：

```bash
bin/x report daily --date 20260325
```

输出：

```text
reports/20260325/candidates.json
reports/20260325/candidates.csv
reports/20260325/summary.md
```
