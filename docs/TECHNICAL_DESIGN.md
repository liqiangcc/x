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

## 9. 历史交易模拟器

模拟器作为现有数据账本和信号系统之上的独立应用域，不把账户、订单或 UI 逻辑写入 `src/signals/`。

```text
历史证券、行情、公司行为和规则账本
  -> 时间截断数据端口
  -> 选股与共享指标
  -> 模拟器核心
  -> Fastify 应用用例
  -> React 响应式界面
```

建议模块：

```text
src/simulator/core/          会话、时钟、订单、成交、账户和领域事件
src/simulator/mechanisms/    市场规则、费用、滑点、撮合和风控
src/simulator/selection/     历史 Universe、信号适配、排序和匿名候选
src/simulator/application/   创建、推进、决策、克隆、揭晓和报告用例
src/simulator/ports/         行情、证券主数据、规则和持久化端口
src/simulator/adapters/      本地账本、SQLite 和 HTTP 适配器
web/simulator/               React + Apache ECharts 单页应用
```

依赖规则：

- `core` 不依赖文件系统、SQLite、Fastify、React 或具体信号。
- `application` 编排端口和机制，不直接解析原始 K 线文件。
- `src/signals/` 保持纯函数，不读取账户、订单或模拟会话。
- UI 只调用应用 API，不复制费用、风控、身份映射或成交规则。

## 10. 技术栈与运行方式

首版定位为本机单用户应用：

- Fastify 提供 REST API 和输入 schema 校验。
- SQLite 保存会话事务状态、冻结资产和只追加事件。
- JSON 用于完整审计导出，不作为并发可变状态的主存储。
- React 构建候选池和交易页面。
- Apache ECharts 绘制日线、年线、成交量和 BOLL。
- 内部证券标识统一为 `code + market`；匿名客户端只使用 `candidateId` 或会话内别名。

候选、图表、账户、持仓、订单和成交 API 默认不返回股票名称与真实代码。匿名映射在服务端解析；随机盲测在会话完成或主动结束前禁止揭晓。

界面采用移动优先响应式设计：桌面端同时展示日线和年线，手机端使用单列卡片、图表标签和底部固定交易操作区，并支持触摸缩放与横屏。

## 11. 建设顺序

模拟器优先交付可交易纵向切片：

1. 适配现有 `data/universe`、`data/pool` 和 `data/kline`，建立明确标记的 `legacy_approximate` 模式。
2. 使用固定夹具完成确定性账户、订单、撮合和时间隔离内核。
3. 接入 `year_decline_close_breakout`、现有可用 Universe 和匿名候选映射。
4. 完成 Fastify、SQLite、会话克隆、JSON 导出和复盘报告。
5. 完成 React 桌面与手机端界面，形成可交易系统。
6. 将历史证券状态、不复权日线、公司行为、点时复权因子和历史规则列为 P3 TODO，后续接入 `historical_accurate` 模式。

MVP 可以用现有前复权 K 线近似成交，但必须在会话、接口、界面和报告展示近似标记，并拒绝非有限或非正数价格。精确模式不得在数据预检失败时静默降级。
