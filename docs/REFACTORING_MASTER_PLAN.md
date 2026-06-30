# x 仓库重构总计划

> 日期：2026-06-30  
> 适用仓库：`liqiangcc/x`  
> 总目标：基于业务目标重新梳理需求、数据契约、技术方案和实施路线，把 `x` 重构为一个以 Git 仓库为数据账本的 A 股数据采集、信号研究和报告生成系统。

## 1. 总体结论

当前项目不应直接进入大规模代码重构。正确顺序是：

```text
业务目标
  -> 核心使用场景
  -> 需求文档
  -> 数据契约
  -> 技术方案
  -> 重构计划
  -> 最小闭环实现
  -> GitHub Actions 自动化
  -> 信号和报告产品化
```

项目的最终形态不是“很多脚本能抓数据”，而是：

```text
围绕每个交易日，自动完成 pool 拉取、codes 构建、kline 补齐、质量校验、信号计算、报告生成，并把数据、运行记录和报告作为规范 Git 提交保存下来。
```

## 2. 项目定位

`x` 应定位为：

```text
A 股数据采集 + 数据账本 + 信号研究 + 每日报告 的自动化工作区
```

采用 **Repo-as-Data-Ledger** 模式：

```text
Git 仓库 = 代码 + 数据 + 运行记录 + 报告 的统一账本
GitHub Actions = 自动采集、校验、提交、记录 commit message 的执行器
```

这意味着：

- 数据可以直接提交到仓库。
- 每次数据提交必须有清晰 commit message。
- 每次批量任务必须有 `run.json`。
- 失败项必须写入 `failures.json`。
- 质量检查必须写入 `quality.json`。
- 每日报告必须放入 `reports/<date>/`。

## 3. 核心业务目标

### 3.1 目标一：每日自动生成候选股票报告

每天自动回答：

```text
今天哪些股票值得研究？
为什么值得研究？
来自哪个 pool？
用了哪些信号？
数据是否完整可信？
```

目标输出：

```text
reports/<YYYYMMDD>/candidates.csv
reports/<YYYYMMDD>/candidates.json
reports/<YYYYMMDD>/summary.md
reports/<YYYYMMDD>/quality.json
```

### 3.2 目标二：把每天的数据状态提交进 Git 仓库

每天的数据采集结果都应该进入 Git 历史：

```text
data/pool/<YYYYMMDD>/
data/kline/<period>/<prefix>/<code>.json
runs/<run_id>/
reports/<YYYYMMDD>/
```

数据提交必须通过 commit message 表达：

```text
日期
run_id
period
engine
total
success
failed
skipped
quality
```

### 3.3 目标三：每次运行可追溯、可重试

每次运行要能回答：

```text
这次任务什么时候跑的？
输入是什么？
参数是什么？
成功多少？
失败多少？
失败项是什么？
能否只重试失败项？
生成了哪些文件？
对应哪个 commit？
```

### 3.4 目标四：数据质量成为正式门禁

坏数据不能进入信号和报告。

必须检查：

```text
JSON 是否可解析
data.klines 是否存在
klines 是否为空
日期是否升序
日期是否重复
字段数量是否正确
OHLC 是否合理
volume / turnover 是否非负
pool qdate 是否正确
失败项是否可见
```

### 3.5 目标五：信号和报告成为最终产品

采集只是中间过程，最终价值是：

```text
候选股票
候选理由
信号列表
评分
质量状态
复盘摘要
```

## 4. 核心使用场景

### 4.1 场景一：每日自动选股

目标命令：

```bash
x daily --latest --commit
```

内部流程：

```text
拉取最近交易日 pool
生成 codes
补齐 daily kline
补齐 yearly kline
执行质量检查
计算信号
生成日报
自动提交 data/runs/reports
```

验收：

```text
data/pool/<date>/ 存在
codes.json 存在
data/kline/daily/<prefix>/<code>.json 存在
runs/<run_id>/run.json 存在
runs/<run_id>/quality.json 存在
reports/<date>/summary.md 存在
Git commit message 符合规范
```

### 4.2 场景二：手动指定日期补数据

目标命令：

```bash
x daily --date 20260325 --period daily --commit
```

适用于：

```text
补历史交易日
修复某天数据
复盘某天信号
重新生成报告
```

### 4.3 场景三：失败项重试

目标命令：

```bash
x run failures <run_id>
x run retry <run_id>
x git commit-data --run-id <retry_run_id>
```

验收：

```text
能列出失败股票
能只重试失败股票
重试结果进入新的 run.json
提交信息说明 recover 数量
```

### 4.4 场景四：查看某只股票数据历史

目标命令：

```bash
git log --oneline -- data/kline/daily/000/000007.json
```

目标：

```text
能追溯某只股票 kline 什么时候被创建、什么时候被更新、对应哪次 run。
```

### 4.5 场景五：策略信号研究

目标命令：

```bash
x signal year-breakout --date 20260325
x signal limit-up --date 20260325
x report daily --date 20260325
```

目标输出：

```text
reports/<date>/candidates.json
reports/<date>/candidates.csv
reports/<date>/summary.md
```

## 5. 文档体系计划

重构前先补齐文档体系。

### 5.1 `docs/PRODUCT_REQUIREMENTS.md`

目的：定义业务目标和 MVP 范围。

应包含：

```text
项目背景
项目定位
业务目标
核心使用者
核心使用场景
输入输出
MVP 范围
非目标
验收标准
```

### 5.2 `docs/USER_WORKFLOWS.md`

目的：定义用户工作流。

应包含：

```text
每日自动选股
手动指定日期补数据
失败项重试
查看运行记录
查看某只股票历史
生成日报
后续回测流程
```

每个流程写清楚：

```text
触发方式
输入
步骤
输出
提交信息
失败处理
验收标准
```

### 5.3 `docs/DATA_CONTRACT.md`

目的：定义数据格式，避免后续重构反复改结构。

应包含：

```text
pool JSON 结构
codes.json 结构
kline JSON 结构
run.json 结构
failures.json 结构
quality.json 结构
candidates.json 结构
summary.md 结构
```

### 5.4 `docs/TECHNICAL_DESIGN.md`

目的：定义技术实现方案。

应包含：

```text
整体架构
CLI 设计
GitHub Actions 设计
Node 模块设计
Kline Runner 设计
Eastmoney Client 设计
数据写入设计
质量门禁设计
自动提交设计
错误处理设计
```

### 5.5 `docs/REFACTORING_PLAN.md`

目的：定义可执行任务清单。

应包含：

```text
Phase 划分
每个 Phase 的目标
改动文件
任务列表
验收命令
预期提交
风险
回滚方式
```

### 5.6 已有文档的定位

```text
docs/VALUE_DRIVEN_REFACTORING.md    价值导向和总体架构说明
docs/DATA_COMMIT_POLICY.md          数据提交规范
docs/REFACTORING_MASTER_PLAN.md     本总计划入口
```

## 6. MVP 范围

第一版 MVP 必须克制。

### 6.1 MVP 做什么

只做一条最小闭环：

```text
指定日期 / 最近交易日
  -> 拉 pool
  -> 生成 codes
  -> 拉前 N 个 daily kline
  -> 检查空 kline
  -> 写 run.json
  -> 写 quality.json
  -> 自动提交 data + runs
```

目标命令：

```bash
x daily --latest --limit 10 --period daily --commit
```

### 6.2 MVP 不做什么

第一版暂不做：

```text
复杂信号系统
复杂回测
数据库导入
全量历史补数
多 period 同时跑
复杂候选评分
多 workflow 拆分提交
可视化报表
```

### 6.3 MVP 验收标准

```text
能本地运行 x daily --latest --limit 10 --period daily --commit
能生成 data/pool/<date>/
能生成 data/pool/<date>/codes.json
能生成 data/kline/daily/<prefix>/<code>.json
能生成 runs/<run_id>/run.json
能生成 runs/<run_id>/quality.json
能生成规范 Git commit message
重复运行无数据变化时不产生无意义 diff
```

## 7. 技术架构方向

### 7.1 统一 CLI

新增：

```text
bin/x
```

目标命令：

```bash
x doctor
x pool pull --latest
x codes build data/pool/<date>
x kline sync data/pool/<date> --period daily --limit 10
x kline validate --period daily
x run show <run_id>
x run failures <run_id>
x run retry <run_id>
x git commit-data --date <date>
x daily --latest --commit
```

初期 `bin/x` 可以是薄封装，内部调用现有 Node 脚本。

### 7.2 Node 主线模块化

现有 Node 主线应抽成模块：

```text
src/core/date.js
src/core/secid.js
src/core/retry.js
src/core/config.js
src/core/logger.js

src/sources/eastmoney/jsonp.js
src/sources/eastmoney/headers.js
src/sources/eastmoney/poolClient.js
src/sources/eastmoney/klineClient.js

src/runners/localKlineRunner.js
src/runners/awsLambdaKlineRunner.js
src/runners/autoKlineRunner.js
src/runners/replayFixtureRunner.js

src/pipelines/pullPool.js
src/pipelines/buildCodes.js
src/pipelines/syncKlines.js
src/pipelines/dailyWorkflow.js

src/quality/validateKline.js
src/quality/validatePool.js

src/git/commitData.js
```

### 7.3 旧 Bash 处理

旧 Bash 不立即删除。

处理原则：

```text
短期保留
不再承载新功能
能迁移的迁移到 Node
迁移完成后放入 legacy/bash/
README 中弱化旧入口
```

### 7.4 数据文件写入

Kline 写入目标：

```text
data/kline/<period>/<prefix>/<code>.json
```

数据文件要求：

```text
字段顺序稳定
日期升序
不写 source_region / fetched_at 这类动态字段
动态运行信息写入 run.json
```

### 7.5 GitHub Actions

两类 workflow：

```text
.github/workflows/ci.yml
.github/workflows/daily-data-commit.yml
```

`ci.yml`：

```text
JS syntax check
Python compile check
Shell syntax check
fixture smoke test
```

`daily-data-commit.yml`：

```text
schedule / workflow_dispatch
pull pool
build codes
sync kline
validate
write run manifest
commit data
push
```

## 8. 重构阶段计划

## Phase 0：需求与规范冻结

### 目标

在动代码前，把业务目标、使用流程、数据契约和执行计划写清楚。

### 任务

```text
新增 docs/PRODUCT_REQUIREMENTS.md
新增 docs/USER_WORKFLOWS.md
新增 docs/DATA_CONTRACT.md
补充 docs/TECHNICAL_DESIGN.md 初稿
补充 docs/REFACTORING_PLAN.md 初稿
检查 docs/DATA_COMMIT_POLICY.md 是否和本计划一致
```

### 验收

```text
能明确回答核心场景是什么
能明确回答 MVP 做什么/不做什么
能明确回答数据格式是什么
能明确回答数据如何提交
```

### 推荐提交

```text
docs: add product requirements
docs: add user workflows
docs: add data contract
docs: add technical design
docs: add executable refactoring plan
```

## Phase 1：统一 CLI 最小入口

### 目标

新增 `bin/x`，形成唯一推荐入口。

### 任务

```text
新增 bin/x
实现 x doctor
实现 x pool pull
实现 x codes build
实现 x kline sync
实现 x kline validate
实现 x daily --latest --limit 10 --period daily
更新 README 快速开始
```

### 验收命令

```bash
x doctor
x daily --latest --limit 10 --period daily
```

### 推荐提交

```text
build: add unified x cli wrapper
```

## Phase 2：Run Manifest 和 Quality 标准化

### 目标

每次运行都生成标准运行记录和质量报告。

### 任务

```text
实现 run_id 生成
实现 runs/<run_id>/run.json
实现 runs/<run_id>/quality.json
实现 runs/<run_id>/failures.json
改造 query_pool_klines summary 输出
统一 total/success/failed/skipped 字段
```

### 验收

```text
每次 x daily 都有 run.json
失败项写入 failures.json
质量检查写入 quality.json
```

### 推荐提交

```text
quality: add run manifest and quality report
```

## Phase 3：数据提交能力

### 目标

实现本地自动提交数据。

### 任务

```text
实现 x git status-data
实现 x git commit-data
commit message 按 DATA_COMMIT_POLICY 生成
无 diff 时跳过提交
提交 data/runs/reports
```

### 验收命令

```bash
x daily --latest --limit 10 --period daily --commit
```

### 推荐提交

```text
git: add data commit command
```

## Phase 4：GitHub Actions 自动提交数据

### 目标

GitHub Actions 支持手动和定时自动采集并提交。

### 任务

```text
新增 .github/workflows/ci.yml
新增 .github/workflows/daily-data-commit.yml
支持 workflow_dispatch 输入 date/limit/period/engine
支持 schedule
配置 contents: write
自动 commit 和 push
避免无变化提交
```

### 验收

```text
手动触发 workflow 能成功生成数据提交
无数据变化时 workflow 不提交
commit message 符合规范
```

### 推荐提交

```text
ci: add daily data commit workflow
```

## Phase 5：Kline 分片和 deterministic writer

### 目标

减少无意义 diff，提高仓库长期可维护性。

### 任务

```text
将 kline 输出迁移到 data/kline/<period>/<prefix>/<code>.json
移除数据文件中的 source_engine/source_region/meta 动态字段
动态运行信息写入 run.json
保证同样输入重复运行不产生 diff
迁移已有 data/kline/daily/*.json 到分片目录
```

### 验收

```text
重复运行同一任务无 diff
单个 kline 目录文件数可控
某只股票可通过 git log 精确追踪
```

### 推荐提交

```text
refactor: write deterministic sharded kline data
```

## Phase 6：Node 模块化

### 目标

把现有脚本中的核心逻辑抽成可测试模块。

### 任务

```text
抽出 date 工具
抽出 secid 工具
抽出 retry 工具
抽出 jsonp 解析
抽出 poolClient
抽出 klineClient
抽出 KlineRunner 接口
实现 Local/Aws/Auto runner
```

### 验收

```bash
node --test
x daily --latest --limit 10 --period daily
```

### 推荐提交

```text
refactor: extract eastmoney client and kline runners
```

## Phase 7：质量门禁升级

### 目标

从“空文件检查”升级为完整数据质量检查。

### 任务

```text
校验 kline 字段数量
校验日期升序
校验日期不重复
校验 OHLC 合理性
校验 volume/turnover 非负
校验 pool qdate
校验 dt/qs/zb/zt 齐全
quality.json 标准化输出
```

### 验收

```text
质量问题能准确进入 quality.json
失败项能进入 failures.json
commit message 能体现 failed 数量
```

### 推荐提交

```text
quality: strengthen pool and kline validation
```

## Phase 8：信号和日报 MVP

### 目标

开始产出真正的业务结果。

### 任务

```text
实现 limit_up_pool 信号
实现 year_breakout 信号
实现 volume_expand 信号
实现 candidates.json
实现 candidates.csv
实现 summary.md
实现 x report daily
```

### 验收命令

```bash
x report daily --date <date>
```

### 预期输出

```text
reports/<date>/candidates.json
reports/<date>/candidates.csv
reports/<date>/summary.md
```

### 推荐提交

```text
report: add daily candidate report
```

## Phase 9：历史补数和失败重试增强

### 目标

支持更稳定的长期数据建设。

### 任务

```text
支持 x pool pull --range-days N
支持 x kline retry --run-id <run_id>
支持 x run failures <run_id>
支持 x run list
支持跳过已存在且质量通过的数据
```

### 推荐提交

```text
run: add failure retry workflow
```

## Phase 10：旧脚本 legacy 化

### 目标

减少入口混乱，明确新主线。

### 任务

```text
将不再推荐的 Bash 入口移动到 legacy/bash/
README 只保留 x CLI 主线
保留旧脚本兼容说明
删除或归档无用测试日志和临时文件
```

### 推荐提交

```text
chore: move legacy bash scripts under legacy
```

## 9. 推荐实施顺序

严格按顺序执行：

```text
1. 文档冻结
2. CLI 最小入口
3. Run manifest
4. 数据提交命令
5. GitHub Actions 自动提交
6. Kline 分片和 deterministic writer
7. Node 模块化
8. 质量门禁升级
9. 信号和日报
10. 历史补数和失败重试
11. legacy 清理
```

不要跳过前面的需求和数据契约，直接做技术重构。

## 10. Git 提交策略

### 10.1 文档提交

```text
docs: add product requirements
docs: add user workflows
docs: add data contract
docs: add technical design
docs: add executable refactoring plan
```

### 10.2 代码提交

```text
build: add unified x cli wrapper
quality: add run manifest and quality report
git: add data commit command
ci: add daily data commit workflow
refactor: write deterministic sharded kline data
refactor: extract eastmoney client and kline runners
quality: strengthen pool and kline validation
report: add daily candidate report
```

### 10.3 数据提交

```text
data(pool): 20260325 add dt qs zb zt snapshots
data(codes): 20260325 build 312 pool codes
data(kline): 20260325 daily update 300/312 ok
quality(kline): 20260325 record daily quality report
report(daily): 20260325 add 18 candidates
```

## 11. 风险和控制

### 11.1 数据提交导致仓库膨胀

控制：

```text
Kline 按前缀分片
不提交数据库
不提交压缩包
不提交临时日志
避免单次提交过多无关文件
定期检查仓库大小
```

### 11.2 无意义 diff 太多

控制：

```text
deterministic writer
移除数据文件动态字段
排序稳定
重复运行无 diff
```

### 11.3 GitHub Actions 并发提交冲突

控制：

```text
workflow concurrency
提交前 git pull --rebase
无 diff 跳过提交
定时任务和手动任务避免同一时间运行
```

### 11.4 外部 API 不稳定

控制：

```text
retry
fallback
failures.json
run retry
质量报告
允许 completed_with_failures
```

### 11.5 旧脚本混乱

控制：

```text
README 只推荐 x CLI
旧脚本移动到 legacy
新功能不再写 Bash
```

## 12. Codex 执行提示词

后续可以把下面提示词交给 Codex 执行。

```text
你正在维护 liqiangcc/x 仓库。请严格按照 docs/REFACTORING_MASTER_PLAN.md、docs/DATA_COMMIT_POLICY.md、docs/VALUE_DRIVEN_REFACTORING.md 执行重构。

当前阶段只执行 Phase 0：需求与规范冻结。

任务：
1. 新增 docs/PRODUCT_REQUIREMENTS.md。
2. 新增 docs/USER_WORKFLOWS.md。
3. 新增 docs/DATA_CONTRACT.md。
4. 新增 docs/TECHNICAL_DESIGN.md 初稿。
5. 新增 docs/REFACTORING_PLAN.md 初稿。
6. 不改业务代码。
7. 不移动数据文件。
8. 不新增 GitHub Actions。

要求：
- 文档必须围绕 Repo-as-Data-Ledger 模式。
- 数据直接提交到仓库，但必须符合 DATA_COMMIT_POLICY。
- MVP 只覆盖 x daily --latest --limit 10 --period daily --commit。
- 每份文档要有清晰的目标、范围、验收标准。
- 提交信息使用：docs: add requirements and refactoring design docs。
```

完成 Phase 0 后，再进入 Phase 1。

## 13. 最终验收标准

整个重构完成后，应满足：

```bash
x doctor
x daily --latest --limit 10 --period daily --commit
x run list
x run show <run_id>
x kline validate --period daily
x report daily --date <date>
```

仓库中应留下：

```text
data/pool/<date>/
data/kline/daily/<prefix>/<code>.json
runs/<run_id>/run.json
runs/<run_id>/quality.json
runs/<run_id>/failures.json
reports/<date>/candidates.json
reports/<date>/candidates.csv
reports/<date>/summary.md
```

Git log 应清晰显示：

```text
data(pool): <date> add snapshots
data(kline): <date> daily update <success>/<total> ok
quality(kline): <date> record quality report
report(daily): <date> add candidates
```

这就是 `x` 从脚本工作区重构为数据账本型研究系统的完整路线。