# 产品需求说明

> 日期：2026-06-30  
> 适用仓库：`x`  
> 目标：定义 Repo-as-Data-Ledger 重构的业务目标、MVP 范围和验收标准。

## 1. 项目定位

`x` 是一个 A 股数据采集、数据账本、信号研究和每日报告生成工作区。

项目采用 Repo-as-Data-Ledger 模式：

```text
Git 仓库 = 代码 + 数据 + 运行记录 + 质量报告 + 研究报告
GitHub Actions = 自动采集、校验、提交和记录 commit message 的执行器
```

核心价值不是“脚本更多”，而是每天稳定留下可追溯、可校验、可复盘的数据和报告。

## 2. 核心使用者

- 维护数据采集任务的开发者。
- 基于涨停池、强势池、K 线和信号做研究的使用者。
- 通过 Git 历史复盘每日数据状态和候选股票的使用者。

## 3. 核心目标

每天围绕一个交易日自动完成：

```text
pool 拉取
  -> codes 构建
  -> kline 补齐
  -> 质量校验
  -> 运行记录归档
  -> 数据提交
  -> 后续信号和日报生成
```

系统必须能回答：

- 今天抓取了哪些 pool？
- 基于哪些股票代码补齐了 kline？
- 成功、跳过、失败分别是多少？
- 失败项是什么，能否重试？
- 数据质量是否可用于信号计算？
- 这些数据对应 Git 历史中的哪次提交？

## 4. MVP 范围

第一版只实现最小闭环：

```bash
x daily --latest --limit 10 --period daily --commit
```

MVP 必须完成：

- 拉取最近交易日或指定日期的 `dt/qs/zb/zt` pool。
- 生成 `data/pool/<YYYYMMDD>/codes.json`。
- 根据 codes 拉取前 N 只股票的 daily kline。
- 写入 `data/kline/daily/<prefix>/<code>.json`。
- 写入 `runs/<run_id>/run.json`。
- 写入 `runs/<run_id>/quality.json`。
- 有失败项时写入 `runs/<run_id>/failures.json`。
- 可选执行规范数据提交。

## 5. 非目标

MVP 暂不覆盖：

- 全量历史补数。
- 多 period 一次性同步。
- 复杂信号评分系统。
- 复杂回测。
- 数据库迁移和入库。
- 可视化报表。
- 旧 Bash 脚本整体迁移。

这些内容在最小闭环稳定后逐步推进。

## 6. 输出要求

允许提交到仓库的常规输出：

```text
data/pool/<YYYYMMDD>/
data/kline/<period>/<prefix>/<code>.json
runs/<run_id>/run.json
runs/<run_id>/failures.json
runs/<run_id>/quality.json
reports/<YYYYMMDD>/
```

不作为常规输出提交：

```text
*.log
*.db
*.sqlite
*.duckdb
*.zip
*.tar.gz
node_modules/
.env
config/local.json
```

## 7. 验收标准

MVP 完成后应满足：

```bash
x doctor
x daily --latest --limit 10 --period daily
x kline validate --period daily
x daily --latest --limit 10 --period daily --commit
```

验收检查：

- `data/pool/<date>/` 存在。
- `data/pool/<date>/codes.json` 存在。
- `data/kline/daily/<prefix>/<code>.json` 存在。
- `runs/<run_id>/run.json` 存在。
- `runs/<run_id>/quality.json` 存在。
- 有失败时 `runs/<run_id>/failures.json` 存在。
- 重复运行同一输入不产生无意义 diff。
- 数据提交 message 符合 `docs/DATA_COMMIT_POLICY.md`。
