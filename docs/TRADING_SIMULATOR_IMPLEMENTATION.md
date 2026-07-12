# 历史交易模拟器实施说明

> 日期：2026-07-12
> 状态：Approved for implementation
> 对应设计：`docs/TRADING_SIMULATOR_DESIGN.md`、`docs/SIGNALS_DESIGN.md`、`docs/DATA_CONTRACT.md`
> 任务入口：`tasks/TASK-20260712-1701-trading-simulator.md`

## 1. 交付目标

首版优先交付可以完成交易闭环的本机单用户历史日线练习应用：

- 复用仓库现有 `data/universe`、`data/pool` 和 `data/kline`，只在已有数据覆盖范围内生成候选和交易。
- 默认选择连续 4 个完整自然年度下跌、今日为本年度首次收盘突破去年最高价的股票。
- 候选、图表、持仓、订单和成交默认匿名，避免股票身份干扰判断。
- 从 D 日收盘做决策，订单只在 D+1 开盘尝试成交。
- 支持桌面和手机端完整浏览、下单、完成决策和推进会话。
- 保存候选证据、交易理由、订单、成交、账户快照和复盘报告。

首版不包含自动策略、批量回测、公网认证和多用户。历史退市/ST、真实不复权行情、公司行为、点时复权和完整历史规则列为后续数据准确性 TODO，不阻塞交易系统 MVP。

## 2. 实施顺序

必须按以下优先级推进：

```text
P0 工程契约和现有数据适配
  -> P0 默认候选与模拟内核
  -> P1 SQLite 与 Fastify API
  -> P2 React 响应式界面
  -> P2 复盘与端到端验收
  -> P3 历史精确数据 TODO（不阻塞 MVP）
```

MVP 使用明确标记的 `legacy_approximate` 数据模式：现有前复权 K 线同时用于图表、信号和模拟成交，结果只服务交易练习，不宣称是精确历史回测。所有会话和报告必须显示近似模式及缺失能力。后续补齐真实数据后增加 `historical_accurate` 模式，不改变交易核心接口。

## 3. 工程结构

服务端继续使用 CommonJS、双引号、分号和 2 空格缩进。

```text
src/simulator/
  core/
    account.js
    events.js
    fill.js
    market_clock.js
    order.js
    position.js
    session.js
  data/
    corporate_actions.js
    historical_rules.js
    point_in_time_adjustment.js
    security_master.js
  selection/
    aliases.js
    boll.js
    historical_universe.js
    pipeline.js
    year_decline_close_breakout.js
  mechanisms/
    a_share_rules.js
    fee_model.js
    fill_model.js
    risk_manager.js
    slippage_model.js
  application/
    sessions.js
    orders.js
    reports.js
  ports/
    market_data_repository.js
    rule_repository.js
    security_repository.js
    session_repository.js
  adapters/
    ledger/
    sqlite/
    http/

web/simulator/
  src/
    api/
    components/
    pages/
    charts/
    styles/
  package.json
  vite.config.js
```

依赖方向：

```text
adapters -> application -> core
               |           ^
               +-> data ---+
               +-> selection
               +-> mechanisms
```

约束：

- `core` 不依赖文件、数据库、Fastify、React 或具体信号。
- `application` 只通过端口读写数据和会话。
- `src/signals/` 保持纯函数，不读取模拟账户或订单。
- UI 不复制费用、成交、风控或匿名映射规则。
- 内部证券标识统一为 `code + market`；客户端只使用 `candidateId` 或会话别名。

## 4. 依赖与脚本

根项目新增：

- `fastify`：HTTP API 和请求 schema 校验。
- `better-sqlite3`：同步 SQLite 事务和迁移。
- 配置 schema 校验库，服务端和高级 JSON 配置共用 schema。

`web/simulator` 新增：

- `react`、`react-dom`、`react-router-dom`。
- `echarts`。
- `vite`、`vitest`、Testing Library。
- `@playwright/test`。

根脚本：

```json
{
  "dev:simulator": "同时启动 Fastify 和 Vite",
  "start:simulator": "启动生产 Fastify 服务",
  "build:web": "构建 React 前端",
  "test:web": "运行前端组件测试",
  "test:e2e": "运行 Playwright 端到端测试"
}
```

现有 `npm run check` 和 `npm test` 行为保持兼容。

## 5. MVP 现有数据适配

### 5.1 现有来源

MVP 不新增大规模抓取前置条件，按以下优先级复用数据：

- Universe：优先使用 `data/universe/<YYYYMMDD>/codes.json`；缺失时使用 `data/pool/<YYYYMMDD>/codes.json`；仍缺失时从本地日线、年线文件交集建立 `existing_kline_universe`。
- 日线和年线：使用 `data/kline/daily`、`data/kline/yearly`。
- 候选池和信号：复用 `src/signals/` 的解析、能力与 evidence。
- 交易日历：从现有日线日期并集构建，缺少基准日历时记录质量警告。

所有行情数组仍必须在适配器返回前按 `date <= asOfDate` 截断。现有 K 线中价格不为有限正数时，该证券在对应日期不可交易并输出 `invalid_execution_price`。

### 5.2 近似执行规则

- `dataMode` 固定为 `legacy_approximate`。
- 现有前复权开盘价用于次日模拟成交；会话、界面、事件和报告持续展示“近似价格”标识。
- 保留 T+1、100 股整手、现金、持仓、冻结资产和订单状态等确定机制。
- 默认费用：佣金 0.03%、最低 5 元，卖出印花税 0.05%；允许配置覆盖，并标记为非历史版本化。
- 能从现有字段可靠判断停牌或封板时执行限制；字段不足时记录 `market_rule_approximation`，不阻止会话。
- 默认滑点仍为 0.1%，成交价不得为非正数。
- 会话冻结所用文件的内容摘要，保证同一数据版本可重放。

### 5.3 MVP 数据访问契约

```js
marketDataRepository.listAvailableCodes({ asOfDate });
marketDataRepository.getLegacyBar({ code, market, date });
marketDataRepository.getLegacyHistory({ code, market, endDate, limit });
```

MVP 数据门禁只检查：

- 选定日期存在可用 Universe。
- 候选至少具备策略所需的连续年线和当年日线。
- 交易标的 D+1 存在有限正数的开盘价。
- 关键文件可解析且内容摘要与会话版本一致。

## 6. 历史精确数据 TODO

### 6.1 数据集合

需要独立维护：

- 历史证券主数据：上市、退市、交易所、板块、名称有效区间。
- 历史证券状态：正常、ST、*ST、退市整理、停牌。
- 不复权日线：真实 OHLC、前收盘、成交量、成交额。
- 公司行为：分红、送转、配股、拆合股及已知日期。
- 点时前复权因子：只使用模拟日期当时已经发生且已知的公司行为。
- 历史规则：涨跌停、最小报价、T+1、整手、佣金、印花税和过户费。
- 沪深 300 基准行情及其数据版本。

东方财富作为主要行情来源；交易所等公开数据源补充退市、状态和公司行为。每个字段记录来源、抓取时间、质量等级和冲突状态。

### 6.2 未来数据访问契约

```js
securityRepository.listActive({ asOfDate, markets: ["sh", "sz", "bj"] });
marketDataRepository.getRawBar({ code, market, date });
marketDataRepository.getAdjustedHistory({ code, market, endDate, limit });
ruleRepository.getRules({ code, market, date });
```

所有历史数组必须在仓储适配器返回前执行 `date <= asOfDate` 截断。当前年度年线由截断后的日线聚合。

### 6.3 精确模式数据版本与门禁

会话创建时冻结：

```js
{
  universeVersion,
  rawKlineVersion,
  corporateActionVersion,
  ruleVersion,
  benchmarkVersion
}
```

以下任一条件不满足时拒绝未来 `historical_accurate` 会话，但不阻止 `legacy_approximate` MVP：

- 模拟区间缺少有效证券集合。
- 候选证券缺少不复权成交行情。
- 需要跨公司行为但缺少点时复权因子。
- 无法确定证券当日板块、状态或适用规则。
- 数据摘要与会话冻结版本不一致。

这些能力作为 P3 TODO：大规模回填使用 checkpoint、失败队列和质量报告；代码提交与生成数据提交分开。

## 7. 默认候选与指标

### 7.1 默认策略

信号 ID：`year_decline_close_breakout`。

```text
Y-4.close > Y-3.close > Y-2.close > Y-1.close
max(currentYearClosesBeforeToday) <= Y-1.high
today.close > Y-1.high
```

默认配置：

```js
{
  downTransitions: 3,
  requireConsecutiveCalendarYears: true,
  firstBreakoutScope: "current_year",
  breakoutOperator: "gt",
  excludeSpecialTreatment: true,
  orderBy: "breakout_margin_ascending",
  limit: 20
}
```

任一年度缺失、年度不连续、年内曾经收盘突破或今日仅最高价突破时不命中。
MVP 只有在现有数据能可靠识别特殊处理状态时才执行 `excludeSpecialTreatment`；否则保留候选并附加 `special_treatment_status_unknown`，完整历史过滤列为 P3 TODO。

### 7.2 BOLL

共享纯函数：

```js
calculateBollSeries(rows, {
  field: "close",
  period: 20,
  multiplier: 2,
  stddevMode: "population"
});
```

返回与输入日期对齐的上、中、下轨，前 19 个点为 `null`。图表使用完整序列；`WINDOW_BAND` 使用指定日期的同一结果。

### 7.3 匿名映射

- 每个独立会话生成随机盐和稳定别名，如“候选A”。
- 数据库保存 `candidateId -> code + market` 映射。
- 普通匿名会话允许显式揭晓，并追加 `IdentityRevealed` 事件。
- 随机盲测在 `completed` 或 `cancelled` 前拒绝揭晓。
- API 使用白名单 DTO，不得先序列化完整领域对象再删除字段。
- 独立会话的别名和 `candidateId` 不可用于跨会话关联证券。

## 8. 模拟核心

### 8.1 会话时序

```text
创建 D 日收盘会话
  -> 生成候选和账户收盘快照
  -> waiting_for_decision
  -> 提交、修改、取消多笔订单
  -> completeDecision
  -> 冻结资金和可卖股份
  -> running
  -> advance 到 D+1 开盘
  -> 成交或失效并释放冻结资产
  -> D+1 收盘估值和生成候选
  -> waiting_for_decision
```

### 8.2 订单规则

- 首版只支持次日开盘订单。
- 每笔买卖理由必填。
- 同股多单保持独立，分别计算最低佣金。
- 默认滑点为 0.1%，买入向上、卖出向下取不利价格。
- 价格按历史最小报价单位向不利方向取整，不得超出当日高低价和涨跌停范围。
- 涨停价开盘的买单和跌停价开盘的卖单拒绝成交。
- 停牌日不成交。
- 未成交订单在该交易日结束时变为 `expired`，不延续。
- 接受买单时冻结预计金额、费用和滑点缓冲；接受卖单时冻结可卖数量。
- 取消、拒绝或失效时在同一事务中释放冻结资产。
- T+1 在下一交易日开始时释放前日买入的可卖数量。

### 8.3 账户与金额

- 默认初始资金为 100000 元。
- 默认不设置最大持仓数或单股仓位阈值。
- 配置的组合风控默认警告，可切换为硬拒绝。
- 股数使用整数；真实成交价格按最小报价单位保存。
- 现金、冻结金额和费用统一使用人民币分的整数持久化，展示层格式化为元；费率计算结果按适用历史规则取整到分。
- 会话结束时撤销待成交订单；持仓按结束日真实收盘估值，不强制平仓。

## 9. SQLite

数据库默认位置：`var/simulator/simulator.db`，不得混入现有 `db/stocks.db`。

核心表：

```text
schema_migrations
sessions
session_lineage
session_data_versions
selection_presets
candidate_snapshots
candidates
candidate_aliases
orders
fills
positions
account_snapshots
events
```

关键约束：

- `events(session_id, sequence)` 唯一并只追加。
- `candidate_aliases(session_id, candidate_id)` 唯一。
- 候选结果按 `as_of_date + data_version + selection_config_hash` 复用快照缓存。
- 订单状态只允许定义的状态迁移。
- `sessions.version` 用于乐观并发控制，重复推进返回冲突。
- 订单、冻结资产、账户和事件必须在同一 better-sqlite3 事务中提交。
- 迁移文件按递增编号执行，并在测试中验证空库初始化和旧库升级。

## 10. Fastify API

基础路径：`/api/simulator`。

```text
POST   /sessions
GET    /sessions/:sessionId
POST   /sessions/:sessionId/advance
GET    /sessions/:sessionId/candidates
GET    /sessions/:sessionId/chart/:candidateId
GET    /sessions/:sessionId/portfolio
POST   /sessions/:sessionId/orders
PATCH  /sessions/:sessionId/orders/:orderId
DELETE /sessions/:sessionId/orders/:orderId
POST   /sessions/:sessionId/complete-decision
POST   /sessions/:sessionId/clone
POST   /sessions/:sessionId/reveal
POST   /sessions/:sessionId/finish
GET    /sessions/:sessionId/report
POST   /sessions/:sessionId/export
```

行为：

- 所有写请求携带期望的会话版本；版本不一致返回 `409`。
- 非法状态转换返回 `409`，业务拒绝返回结构化 `422`。
- 数据缺失或质量门禁失败返回 `422` 并列出问题代码。
- 未知会话、订单或候选返回 `404`。
- 匿名响应只包含 `candidateId`、别名、相对日期、图表和证据。
- Fastify `inject` 测试覆盖所有状态和匿名字段白名单。
- 首版不引入外部任务队列；全市场候选在本地同步计算并按配置摘要缓存，UI 显示加载状态。同一日期、数据版本和配置不得重复扫描。

## 11. React 响应式界面

### 11.1 页面

- 会话创建：指定日期或随机盲测、初始资金、候选预设。
- 候选池：常用表单、高级 JSON、匿名候选、证据和分页。
- 交易页：日线、年线、BOLL、成交量、账户、持仓和订单。
- 复盘页：收益、回撤、费用、基准、交易理由、候选证据和揭晓结果。

### 11.2 桌面

- 候选配置、列表和证据并排。
- 日线主图与年线副视图同时可见。
- 账户和订单使用侧栏或独立面板。

### 11.3 手机

- 单列候选卡片；配置表单和高级 JSON 使用抽屉或折叠区。
- 日线和年线使用标签切换，日线保留 BOLL 和成交量。
- 买入、卖出、完成决策和推进会话使用底部固定操作区。
- 图表支持触摸缩放、拖动、十字光标和横屏。
- 触摸目标不小于 44px，核心操作不得依赖横向滚动。
- 下单确认展示数量、预计金额、费用、冻结资产和必填理由。

目标尺寸：

```text
375x667
390x844
768x1024
1440x900
```

## 12. 复盘

报告至少包含：

- 总收益、年化收益、最大回撤、波动率、Sharpe 和 Sortino。
- 已实现、未实现盈亏、费用和滑点占比。
- 胜率、盈亏比、持仓时间和换手率。
- MVP 优先输出绝对绩效；已有沪深 300 数据时允许启用，缺失时标记 `benchmark_unavailable` 并列为 TODO。
- 每笔订单的候选快照、信号证据和交易理由。
- 身份揭晓时间、随机盲测状态和父子会话关系。

JSON 导出包含最终配置、数据版本、事件、候选、订单、成交、账户快照和报告。

## 13. 验证矩阵

服务端：

```bash
npm run check
npm test
```

前端：

```bash
npm run test:web
npm run build:web
npm run test:e2e
```

必须覆盖：

- MVP 能从现有 Universe 或 K 线交集建立可交易代码集合。
- 连续 4 年、年度缺失、本年度首次突破、二次上穿和收盘未突破。
- 所有行情、指标和 API 的未来数据隔离。
- 近似数据标识在会话、API、界面和报告中始终可见。
- 资金和股份冻结、多单独立、T+1、封板、停牌和订单失效。
- better-sqlite3 事务回滚、迁移、恢复和重复推进冲突。
- 匿名 API、图表、持仓、订单和成交无真实身份泄漏。
- 普通匿名揭晓和随机盲测结束前拒绝揭晓。
- 四种目标尺寸的浏览、图表、下单、完成决策和推进流程。

## 14. 提交与数据边界

- 每个任务文件子任务完成后独立提交。
- 只提交该子任务相关文件，不混入工作区既有变化。
- 先用少量证券和日期验证抓取及生成流程。
- 全历史回填属于 P3 TODO；执行时使用独立运行记录、checkpoint 和数据提交。
- 不手工修改 `data/pool/`、`data/kline/` 或新历史账本产物。
- 未通过验证的子任务不得标记为完成。
