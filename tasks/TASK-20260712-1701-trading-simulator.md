# 实现历史交易模拟器

- Root ID: `TASK-20260712-1701-trading-simulator`
- Status: `pending`
- Created: `2026-07-12 17:01 CST`
- Source request: 编写实现文档，拆分任务并排优先级；实施历史日线手动交易练习 MVP。
- Task file: `tasks/TASK-20260712-1701-trading-simulator.md`

## Objective

基于仓库已有的市场快照、K 线和信号能力，优先实现本机单用户历史日线交易练习闭环：复用现有数据生成默认反转突破候选，提供匿名候选、确定性订单与账户、Fastify API、better-sqlite3 持久化、React/ECharts 响应式界面和可审计复盘。缺少的历史退市/ST、真实不复权行情、公司行为、点时复权和历史规则列为 P3 TODO，不阻塞首版交易系统。

## Context

- 产品设计见 `docs/TRADING_SIMULATOR_DESIGN.md`，实施契约见 `docs/TRADING_SIMULATOR_IMPLEMENTATION.md`。
- 数据和信号约束见 `docs/DATA_CONTRACT.md`、`docs/SIGNALS_DESIGN.md`。
- 当前 `fetch/fetch_market_stocks.js` 只提供当前沪深 A 股快照，不包含北交所、历史退市和历史状态。
- 当前 `src/sources/eastmoney/client.js#getKline` 固定 `fqt=1`；MVP 明确以 `legacy_approximate` 模式复用该价格成交，并在会话、界面和报告标记近似性。
- 当前信号入口是 `src/signals/daily.js`，能力注册表是 `src/signals/registry.js`，现有 `year_breakout` 语义必须保持兼容。
- 仓库是 CommonJS、Node.js 22+；根目录已有 `src/db/sqlite.js` 的 `node:sqlite` 封装，但本任务确认模拟器使用 `better-sqlite3` 独立数据库。
- 当前没有 Fastify、React 或 Vite 工程；前端新增到 `web/simulator/`。
- `data/pool/<YYYYMMDD>/`、`data/kline/{daily,yearly}/` 和后续历史账本都是生成数据，不手工编辑。
- 当前工作区可能有用户的行情、代理、配置和文档变更；不得回退、覆盖或混入本任务提交。
- 常规验证使用 `npm run check`、`npm test`；新增前端后使用 `npm run test:web`、`npm run build:web`、`npm run test:e2e`。

## Execution Rules

- Execute subtasks in listed order unless dependencies say otherwise.
- Update this file after each subtask with status, notes, validation, changed files, and commit hash.
- Commit only files related to the completed subtask.
- Do not mark a subtask `done` without validation or a documented reason validation was skipped.
- Priority order is `P0 -> P1 -> P2 -> P3`; do not begin a lower-priority task before its declared dependencies are done.
- Use fixed local fixtures for development; run network fetches and full-history backfills only in their designated subtasks.
- Keep code commits separate from generated data commits.
- `TASK-20260712-1701-trading-simulator-T08` is a non-blocking P3 TODO. Do not execute it when the root request is to deliver the trading MVP; execute it only when its task ID is requested explicitly. T01 through T07 are sufficient for the MVP milestone.

## Tasks

### `TASK-20260712-1701-trading-simulator-T01` P0 工程契约与骨架

- Status: `done`
- Depends on: `none`
- Goal: 建立不会影响现有 CLI 和信号行为的模拟器服务端、前端及共享契约骨架。
- Files likely touched: `package.json`, `src/simulator/`, `web/simulator/`, `tests/`
- Validation: `npm run check && npm test && npm run build:web` -> passed (121 JavaScript files checked; 216 server tests; production web build succeeded)

#### Subtasks

##### `TASK-20260712-1701-trading-simulator-T01-S01` 固化实施契约

- Status: `done`
- Goal: 校对实施说明与产品设计，固定目录、领域类型、状态机、API、数据库表和错误语义。
- Steps:
  - 对照四份设计文档检查 `docs/TRADING_SIMULATOR_IMPLEMENTATION.md`。
  - 明确首版只做手动练习、匿名候选、次日开盘订单和手机完整交易。
  - 删除仍存在的未决实现选项或相互冲突的默认值。
- Expected files: `docs/TRADING_SIMULATOR_IMPLEMENTATION.md`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Validation: `git diff --check && rg -n "P0|better-sqlite3|Fastify|React|anonymous|waiting_for_decision" docs/TRADING_SIMULATOR_IMPLEMENTATION.md` -> passed
- Changed files: `docs/TRADING_SIMULATOR_IMPLEMENTATION.md`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `12db3db5`
- Notes: 已固定 MVP 使用现有数据的 `legacy_approximate` 模式、npm workspace、Ajv、concurrently、会话与订单状态枚举、API 错误信封和桌面交易面板断点；P3 精确历史数据继续作为非阻塞 TODO。

##### `TASK-20260712-1701-trading-simulator-T01-S02` 增加依赖和运行脚本

- Status: `done`
- Goal: 安装服务端及前端依赖，并提供一致的开发、构建和测试入口。
- Steps:
  - 根项目增加 Fastify、better-sqlite3 和配置 schema 校验依赖。
  - 创建 `web/simulator/package.json`，加入 React、Vite、ECharts 和测试依赖。
  - 增加 `dev:simulator`、`start:simulator`、`build:web`、`test:web`、`test:e2e` 脚本。
  - 保持现有 `npm run check` 和 `npm test` 行为兼容。
- Expected files: `package.json`, `package-lock.json`, `web/simulator/package.json`, `web/simulator/vite.config.js`
- Validation: `npm install && npm run check && npm test && npm run test:web && npm run build:web` -> passed (204 server tests, 1 web test, production build succeeded)
- Changed files: `.gitignore`, `package.json`, `package-lock.json`, `web/simulator/`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `38019e21`
- Notes: 已建立 npm workspace，安装 Fastify、better-sqlite3、Ajv、React、Vite、ECharts、Vitest、Testing Library、Playwright 和 concurrently；增加根运行脚本、可构建的 React 空应用及基础组件测试，并限制根 `npm test` 只发现 `tests/*.test.js`。

##### `TASK-20260712-1701-trading-simulator-T01-S03` 创建模块骨架和共享契约

- Status: `done`
- Goal: 建立核心、数据、选股、机制、应用、端口和适配器边界。
- Steps:
  - 创建 `src/simulator/` 分层目录和最小导出文件。
  - 定义会话、订单、成交、候选、价格视图和事件枚举。
  - 定义配置 schema 和组件注册接口。
  - 禁止核心模块依赖 Fastify、SQLite 和文件系统。
- Expected files: `src/simulator/core/`, `src/simulator/config/`, `src/simulator/ports/`, `tests/simulator-contracts.test.js`
- Validation: `node --test tests/simulator-contracts.test.js && npm run check` -> passed (6 contract tests; 120 JavaScript files checked)
- Changed files: `src/simulator/`, `tests/simulator-contracts.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `59b217dd`
- Notes: 已定义稳定会话、订单、事件、数据模式和价格视图枚举，证券 ID 契约，Ajv 2020 配置 schema 与默认值，组件注册表及市场数据/会话仓储端口；测试确认核心层没有基础设施依赖。

##### `TASK-20260712-1701-trading-simulator-T01-S04` 建立确定性测试夹具

- Status: `done`
- Goal: 为数据、信号、成交和 API 提供不依赖网络的固定小型市场。
- Steps:
  - 创建包含沪深京、ST、停牌、退市和公司行为的固定证券夹具。
  - 创建连续年度、首次突破、二次突破、封板和 T+1 日线夹具。
  - 定义固定交易日历、费用规则和预期账户结果。
- Expected files: `tests/fixtures/simulator/`, `tests/simulator-fixtures.test.js`
- Validation: `node --test tests/simulator-fixtures.test.js` -> passed (6 fixture invariant tests)
- Changed files: `tests/fixtures/simulator/market.json`, `tests/simulator-fixtures.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `487dfde3`
- Notes: 固定夹具覆盖沪深京、ST、后来退市、停牌、连续 4 年下降、首次突破、年内重复突破、一字涨停、可成交次日开盘和 T+1 可卖数量，后续数据、引擎和 API 测试复用同一市场。

### `TASK-20260712-1701-trading-simulator-T02` P0 现有数据适配

- Status: `done`
- Depends on: `TASK-20260712-1701-trading-simulator-T01`
- Goal: 直接适配现有 Universe、pool、日线和年线，为候选与交易提供带近似标识的稳定数据接口。
- Files likely touched: `src/simulator/data/`, `src/simulator/adapters/ledger/`, `tests/`
- Validation: `npm run check && node --test tests/simulator-data-*.test.js` -> passed (133 JavaScript files checked; 27 data tests)

#### Subtasks

##### `TASK-20260712-1701-trading-simulator-T02-S01` 实现现有 Universe 适配

- Status: `done`
- Goal: 从仓库现有数据建立指定日期可扫描的代码集合。
- Steps:
  - 优先读取 `data/universe/<date>/codes.json`。
  - 缺失时读取 `data/pool/<date>/codes.json`。
  - 再缺失时从本地 daily/yearly 文件交集建立 `existing_kline_universe`。
  - 输出来源、覆盖数量和 `survivorship_bias_possible` 质量标记。
- Expected files: `src/simulator/adapters/ledger/existing_universe.js`, `tests/simulator-data-existing-universe.test.js`
- Validation: `node --test tests/simulator-data-existing-universe.test.js tests/fetch-market-stocks.test.js` -> passed (11 tests)
- Changed files: `src/simulator/adapters/ledger/existing_universe.js`, `tests/simulator-data-existing-universe.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `fd8c913f`
- Notes: 已实现 market snapshot、pool codes、daily/yearly 文件交集三层回退，统一解析 `code + market`，输出覆盖统计及 `historical_universe_unavailable`、`pool_limited_universe`、`kline_derived_universe`、`survivorship_bias_possible` 质量标记。

##### `TASK-20260712-1701-trading-simulator-T02-S02` 实现现有 K 线适配

- Status: `done`
- Goal: 使用现有 daily/yearly 文件为候选、图表和近似成交提供截断后的行情。
- Steps:
  - 复用现有分片和 legacy K 线路径解析。
  - 所有返回数组在适配器内截断到 `asOfDate`。
  - 将现有前复权价格标记为 `legacy_forward_adjusted`。
  - 非有限或非正数价格返回 `invalid_execution_price`，不得成交。
- Expected files: `src/simulator/adapters/ledger/existing_kline_repository.js`, `tests/simulator-data-existing-kline.test.js`
- Validation: `node --test tests/simulator-data-existing-kline.test.js tests/signals-daily-report.test.js` -> passed (17 tests)
- Changed files: `src/simulator/adapters/ledger/existing_kline_repository.js`, `tests/simulator-data-existing-kline.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `fa9f4812`
- Notes: 已兼容分片与 legacy K 线路径，复用现有解析器，强制按 `endDate` 截断，支持窗口 limit，保存 SHA-256 内容摘要，并以 `legacy_forward_adjusted` 标识价格；缺失、损坏和非正执行价格均返回稳定质量问题。

##### `TASK-20260712-1701-trading-simulator-T02-S03` 实现近似交易日历

- Status: `done`
- Goal: 从现有行情构建可以推进的交易日期序列。
- Steps:
  - 从候选 Universe 的日线日期并集生成有序交易日历。
  - 会话推进时跳过无全局行情的日期。
  - 缺少权威基准日历时写入 `trading_calendar_approximation`。
  - 为周末、长假和单股停牌夹具增加测试。
- Expected files: `src/simulator/data/legacy_trading_calendar.js`, `tests/simulator-data-calendar.test.js`
- Validation: `node --test tests/simulator-data-calendar.test.js` -> passed (5 tests)
- Changed files: `src/simulator/data/legacy_trading_calendar.js`, `tests/simulator-data-calendar.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `88e02c85`
- Notes: 已实现日线日期并集日历、日期标准化、next/previous/between 查询和仓储构建；单股停牌不会移除全市场交易日，长假保持空档，所有结果携带 `trading_calendar_approximation`。

##### `TASK-20260712-1701-trading-simulator-T02-S04` 实现 MVP 近似规则配置

- Status: `done`
- Goal: 在历史状态数据不完整时仍提供可交易的明确规则集。
- Steps:
  - 固定 T+1、买入 100 股整手和零股卖出处理。
  - 默认佣金 0.03%、最低 5 元、卖出印花税 0.05%，允许配置覆盖。
  - 能可靠判断停牌或封板时应用限制，字段不足时只记录 `market_rule_approximation`。
  - 将规则版本和近似说明写入会话配置。
- Expected files: `src/simulator/data/legacy_rules.js`, `config/simulator/default.json`, `tests/simulator-data-legacy-rules.test.js`
- Validation: `node --test tests/simulator-data-legacy-rules.test.js` -> passed (5 tests)
- Changed files: `config/simulator/default.json`, `src/simulator/data/legacy_rules.js`, `tests/simulator-data-legacy-rules.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `fc0e2fd6`
- Notes: 已固定 `legacy_approximate` 的 T+1、100 股买入整手、最终零股卖出、0.03%佣金/最低5元、卖出0.05%印花税和0.1%滑点配置；实现费用计算、订单数量校验以及停牌/一字涨跌停限制，并持续返回历史费用和市场规则近似标记。

##### `TASK-20260712-1701-trading-simulator-T02-S05` 实现 MVP 数据门禁和摘要

- Status: `done`
- Goal: 只阻止无法运行的会话，并显式暴露不精确项。
- Steps:
  - 检查 Universe 可用、策略历史窗口充足、D+1 开盘价格为有限正数。
  - 缺少历史状态、原始价格、点时复权和规则版本时输出 TODO/质量标记但不阻止 MVP。
  - 计算所用文件内容摘要并写入会话。
  - 在 API、界面和报告公开 `dataMode: legacy_approximate`。
- Expected files: `src/simulator/data/data_gate.js`, `src/simulator/data/data_manifest.js`, `tests/simulator-data-gate.test.js`
- Validation: `node --test tests/simulator-data-gate.test.js` -> passed (5 tests)
- Changed files: `src/simulator/data/data_gate.js`, `src/simulator/data/data_manifest.js`, `tests/simulator-data-gate.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `e27da482`
- Notes: 已实现 Universe、候选历史和执行价格门禁，区分阻断问题与非阻断精确数据 TODO；数据清单按来源路径稳定排序并计算 SHA-256 摘要，所有结果公开 `dataMode: legacy_approximate` 和完整质量标记。

##### `TASK-20260712-1701-trading-simulator-T02-S06` 建立现有数据端到端夹具

- Status: `done`
- Goal: 证明不新增抓取即可从现有文件完成候选、图表和次日价格读取。
- Steps:
  - 选择仓库内已有的少量证券和日期作为只读集成夹具。
  - 验证 Universe 回退、K 线截断、候选历史窗口和 D+1 开盘读取。
  - 验证负价或缺失价只排除对应交易，不阻断其他候选。
  - 不生成或改写现有行情文件。
- Expected files: `tests/simulator-existing-data-integration.test.js`, `tests/fixtures/simulator/`
- Validation: `node --test tests/simulator-existing-data-integration.test.js` -> passed (3 read-only repository integration tests)
- Changed files: `src/simulator/data/data_manifest.js`, `tests/simulator-existing-data-integration.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `f924e327`
- Notes: 使用仓库现有 `20260701` market Universe 和 `000001` daily/yearly 数据证明无需网络即可获得候选历史窗口、未来截断和 D+1 有效开盘价；现有负复权价格被局部排除且未改写数据。数据清单同时去重同一路径内容摘要。

### `TASK-20260712-1701-trading-simulator-T03` P0 指标与默认候选

- Status: `pending`
- Depends on: `TASK-20260712-1701-trading-simulator-T02`
- Goal: 实现无未来数据泄漏的 BOLL、默认复合候选、现有数据 Universe 和匿名候选快照。
- Files likely touched: `src/signals/`, `src/simulator/selection/`, `tests/`
- Validation: `node --test tests/signals-daily-report.test.js tests/simulator-selection.test.js`

#### Subtasks

##### `TASK-20260712-1701-trading-simulator-T03-S01` 抽取 BOLL 序列

- Status: `done`
- Goal: 为图表和 `WINDOW_BAND` 提供同一套 BOLL 计算。
- Steps:
  - 实现返回完整日期序列的 `calculateBollSeries`。
  - 使用 20 日收盘价、2 倍总体标准差，前 19 点为空。
  - 修改 `WINDOW_BAND` 复用指定日期结果，保持现有能力接口兼容。
  - 增加窗口不足、数值和时间截断测试。
- Expected files: `src/signals/indicators/boll.js`, `src/signals/capabilities/window_band.js`, `tests/signals-daily-report.test.js`
- Validation: `node --test tests/signals-daily-report.test.js tests/simulator-selection.test.js` -> passed (15 tests)
- Changed files: `src/signals/indicators/boll.js`, `src/signals/capabilities/window_band.js`, `tests/simulator-selection.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `b71f0e77`
- Notes: 已抽取完整 BOLL 序列和单窗口计算，默认 20 日/2 倍总体标准差，warmup 点为空；现有 `WINDOW_BAND` 复用同一计算核心并保持能力接口兼容。

##### `TASK-20260712-1701-trading-simulator-T03-S02` 实现默认复合候选

- Status: `done`
- Goal: 实现连续 4 年下跌且本年度今日首次收盘突破去年最高价。
- Steps:
  - 新增 `year_decline_close_breakout`，不修改 `year_breakout` 语义。
  - 要求 4 个连续完整自然年度，任一年缺失则质量失败。
  - 使用本年度此前全部收盘判断首次突破，而非仅前一交易日。
  - 输出年度点、去年最高、此前最高收盘、今日收盘和突破幅度证据。
- Expected files: `src/signals/signals/year_decline_close_breakout.js`, `src/signals/registry.js`, `tests/simulator-selection.test.js`
- Validation: `node --test tests/signals-daily-report.test.js tests/simulator-selection.test.js` -> passed (19 tests)
- Changed files: `src/signals/signals/year_decline_close_breakout.js`, `src/signals/registry.js`, `tests/simulator-selection.test.js`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Commit: `pending`
- Notes: 新增独立复合信号，严格要求最近 4 个连续完整自然年度收盘逐年下降；首次突破使用本年度截至今日之前的全部收盘，未来日期不会参与，并输出可审计的年度点和突破证据。

##### `TASK-20260712-1701-trading-simulator-T03-S03` 实现现有数据选择流水线

- Status: `pending`
- Goal: 从当前可用 Universe 或本地 K 线交集筛选候选，并保留数据范围近似标记。
- Steps:
  - 接入 T02 的 Universe 回退链。
  - 有可靠状态字段时排除当日 ST、*ST 和退市整理；缺失时记录 TODO 标记。
  - 按突破幅度从小到大稳定排序，代码仅作为内部次级排序键。
  - 默认分页 20 条并允许查看全部。
  - 按日期、数据版本和配置摘要缓存候选快照，避免重复全市场扫描。
- Expected files: `src/simulator/selection/historical_universe.js`, `src/simulator/selection/pipeline.js`, `tests/simulator-selection.test.js`
- Validation: `node --test tests/simulator-selection.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T03-S04` 实现匿名候选快照

- Status: `pending`
- Goal: 生成会话内稳定、跨会话不可关联的候选别名和白名单 DTO。
- Steps:
  - 生成随机会话盐、`candidateId` 和“候选A”等别名。
  - 将真实 `code + market` 限制在服务端映射中。
  - 实现匿名候选、证据、图表和持仓 DTO 白名单。
  - 增加真实代码、名称、市场和可反推字段泄漏测试。
- Expected files: `src/simulator/selection/aliases.js`, `src/simulator/selection/candidate_dto.js`, `tests/simulator-anonymity.test.js`
- Validation: `node --test tests/simulator-anonymity.test.js`
- Commit: `pending`
- Notes:

### `TASK-20260712-1701-trading-simulator-T04` P0 确定性交易引擎

- Status: `pending`
- Depends on: `TASK-20260712-1701-trading-simulator-T02`
- Goal: 实现 D 日收盘决策、D+1 开盘成交、冻结资产、T+1、费用和结束估值。
- Files likely touched: `src/simulator/core/`, `src/simulator/mechanisms/`, `tests/`
- Validation: `node --test tests/simulator-engine-*.test.js`

#### Subtasks

##### `TASK-20260712-1701-trading-simulator-T04-S01` 实现市场时钟和会话状态

- Status: `pending`
- Goal: 固定 D 日收盘起始、等待决策和交易日推进语义。
- Steps:
  - 实现交易日历和 `MarketClock`。
  - 实现合法会话状态迁移和版本号。
  - 创建会话后立即生成 D 日收盘快照并进入 `waiting_for_decision`。
  - 禁止重复推进和非法状态调用。
- Expected files: `src/simulator/core/market_clock.js`, `src/simulator/core/session.js`, `tests/simulator-engine-session.test.js`
- Validation: `node --test tests/simulator-engine-session.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T04-S02` 实现账户、持仓和冻结资产

- Status: `pending`
- Goal: 保证现金、持仓、冻结资金和冻结股份守恒。
- Steps:
  - 实现默认 10 万元账户和整数股数。
  - 实现接受、取消、拒绝、失效和成交时的冻结与释放。
  - 实现买入成本、已实现和未实现盈亏。
  - 实现 T+1 可卖数量跨交易日释放。
- Expected files: `src/simulator/core/account.js`, `src/simulator/core/position.js`, `tests/simulator-engine-account.test.js`
- Validation: `node --test tests/simulator-engine-account.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T04-S03` 实现多笔订单决策

- Status: `pending`
- Goal: 支持同日多股票和同股多笔独立订单，完成决策后统一锁定。
- Steps:
  - 实现创建、修改、取消和状态转换。
  - 强制每笔买卖理由非空。
  - 同股多单独立保留理由和费用。
  - `completeDecision` 后禁止修改，并将会话切回 `running`。
- Expected files: `src/simulator/core/order.js`, `src/simulator/application/orders.js`, `tests/simulator-engine-orders.test.js`
- Validation: `node --test tests/simulator-engine-orders.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T04-S04` 实现开盘撮合和 MVP 费用

- Status: `pending`
- Goal: 使用现有前复权开盘价和明确近似规则产生可重放的 MVP 成交。
- Steps:
  - 实现默认 0.1% 双向不利滑点和最小报价取整。
  - 确保成交价不超出真实高低价和涨跌停范围。
  - 实现默认佣金、最低佣金和卖出印花税，并允许配置覆盖。
  - 每笔订单独立计算费用并生成 `Fill`。
  - 在 Fill、事件和报告写入 `legacy_approximate` 价格及规则标记。
- Expected files: `src/simulator/mechanisms/slippage_model.js`, `src/simulator/mechanisms/fee_model.js`, `src/simulator/mechanisms/fill_model.js`, `tests/simulator-engine-fill.test.js`
- Validation: `node --test tests/simulator-engine-fill.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T04-S05` 实现停牌、封板、失效和结束

- Status: `pending`
- Goal: 完成无法成交和会话结束的确定处理。
- Steps:
  - 停牌日不成交。
  - 涨停价开盘买单、跌停价开盘卖单拒绝成交。
  - 未成交订单当日转为 `expired` 并释放冻结资产。
  - 结束时取消待处理订单，持仓按最后真实收盘估值，不强平。
- Expected files: `src/simulator/mechanisms/a_share_rules.js`, `src/simulator/application/sessions.js`, `tests/simulator-engine-market-rules.test.js`
- Validation: `node --test tests/simulator-engine-market-rules.test.js`
- Commit: `pending`
- Notes:

### `TASK-20260712-1701-trading-simulator-T05` P1 SQLite 与 Fastify API

- Status: `pending`
- Depends on: `TASK-20260712-1701-trading-simulator-T03`, `TASK-20260712-1701-trading-simulator-T04`
- Goal: 持久化会话事务和事件，并通过匿名安全 REST API 暴露全部手动练习用例。
- Files likely touched: `src/simulator/adapters/sqlite/`, `src/simulator/adapters/http/`, `tests/`
- Validation: `node --test tests/simulator-sqlite.test.js tests/simulator-api-*.test.js`

#### Subtasks

##### `TASK-20260712-1701-trading-simulator-T05-S01` 建立 better-sqlite3 迁移和仓储

- Status: `pending`
- Goal: 创建独立模拟数据库、迁移和事务仓储。
- Steps:
  - 默认数据库使用 `var/simulator/simulator.db`。
  - 创建实施说明列出的核心表、唯一约束和索引。
  - 实现空库初始化、递增迁移和旧库升级测试。
  - 实现会话、候选、订单、成交、账户快照和事件仓储。
- Expected files: `src/simulator/adapters/sqlite/migrations/`, `src/simulator/adapters/sqlite/repository.js`, `tests/simulator-sqlite.test.js`
- Validation: `node --test tests/simulator-sqlite.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T05-S02` 实现会话和推进 API

- Status: `pending`
- Goal: 提供创建、查询、推进和完成决策端点。
- Steps:
  - 建立 Fastify server 和统一错误响应。
  - 实现会话创建、查询、推进和 `complete-decision`。
  - 写请求校验期望会话版本，冲突返回 `409`。
  - 数据门禁或业务拒绝返回结构化 `422`。
- Expected files: `src/simulator/adapters/http/server.js`, `src/simulator/adapters/http/session_routes.js`, `tests/simulator-api-session.test.js`
- Validation: `node --test tests/simulator-api-session.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T05-S03` 实现订单和查询 API

- Status: `pending`
- Goal: 提供订单编辑、候选、图表和账户查询。
- Steps:
  - 实现订单创建、修改和取消端点。
  - 实现候选、图表和 portfolio 查询。
  - 只接受 `candidateId`，服务端解析真实证券。
  - 为状态错误、未知资源和参数错误增加测试。
- Expected files: `src/simulator/adapters/http/order_routes.js`, `src/simulator/adapters/http/query_routes.js`, `tests/simulator-api-orders.test.js`
- Validation: `node --test tests/simulator-api-orders.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T05-S04` 实现会话克隆

- Status: `pending`
- Goal: 从当前收盘状态创建采用新候选配置的父子分支。
- Steps:
  - 复制当前现金、持仓、历史引用和数据版本。
  - 保存父会话、分支点和新配置摘要。
  - 新配置从下一交易日生效，父会话保持不变。
  - 增加父子恢复和报告关联测试。
- Expected files: `src/simulator/application/sessions.js`, `src/simulator/adapters/http/session_routes.js`, `tests/simulator-api-clone.test.js`
- Validation: `node --test tests/simulator-api-clone.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T05-S05` 实现揭晓、结束、报告和导出 API

- Status: `pending`
- Goal: 完成普通匿名和随机盲测的揭晓边界及审计导出。
- Steps:
  - 普通匿名会话显式揭晓并追加 `IdentityRevealed`。
  - 随机盲测在完成或取消前返回 `409`。
  - 实现结束、报告和 JSON 导出端点。
  - 导出使用临时文件和原子重命名。
- Expected files: `src/simulator/application/reports.js`, `src/simulator/adapters/http/report_routes.js`, `tests/simulator-api-reveal.test.js`
- Validation: `node --test tests/simulator-api-reveal.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T05-S06` 审计匿名 API

- Status: `pending`
- Goal: 证明运行期响应中不存在真实身份泄漏。
- Steps:
  - 为候选、图表、portfolio、订单、成交和事件建立白名单响应测试。
  - 扫描嵌套对象、错误信息、日志和导出文件中的真实代码、名称及市场字段。
  - 验证独立会话不能用别名或 `candidateId` 关联同一证券。
- Expected files: `tests/simulator-api-anonymity.test.js`, `src/simulator/adapters/http/dto.js`
- Validation: `node --test tests/simulator-api-anonymity.test.js`
- Commit: `pending`
- Notes:

### `TASK-20260712-1701-trading-simulator-T06` P2 React 响应式交易界面

- Status: `pending`
- Depends on: `TASK-20260712-1701-trading-simulator-T05`
- Goal: 提供桌面和手机端均可完成全流程的匿名候选与交易 SPA。
- Files likely touched: `web/simulator/`, `tests/e2e/`
- Validation: `npm run test:web && npm run build:web && npm run test:e2e`

#### Subtasks

##### `TASK-20260712-1701-trading-simulator-T06-S01` 建立 React 应用基础

- Status: `pending`
- Goal: 创建路由、API客户端、状态和移动优先样式基础。
- Steps:
  - 建立 Vite、React Router 和应用布局。
  - 实现统一 API 客户端、错误显示和会话版本处理。
  - 定义响应式断点、颜色、间距和最小 44px 触摸目标。
  - 为创建页、候选页、交易页和复盘页建立路由。
- Expected files: `web/simulator/src/`, `web/simulator/src/styles/`, `web/simulator/src/api/`
- Validation: `npm run test:web && npm run build:web`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T06-S02` 实现会话创建和候选配置

- Status: `pending`
- Goal: 支持指定日期、随机盲测、候选预设和冻结配置。
- Steps:
  - 实现日期、初始资金和模式表单。
  - 实现常用候选参数表单和高级 JSON 编辑器。
  - 使用服务端 schema 显示字段级校验错误。
  - 会话开始后禁用原地修改，并提供克隆入口。
- Expected files: `web/simulator/src/pages/CreateSessionPage.jsx`, `web/simulator/src/components/SelectionConfig.jsx`, `web/simulator/src/components/AdvancedConfigEditor.jsx`
- Validation: `npm run test:web`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T06-S03` 实现匿名候选池

- Status: `pending`
- Goal: 使用别名、证据、排序和分页展示候选，不依赖真实身份。
- Steps:
  - 桌面端并排展示配置、候选列表和证据。
  - 手机端使用单列卡片和配置抽屉。
  - 默认 20 条并支持查看全部。
  - 普通匿名提供显式揭晓入口，盲测不显示入口。
- Expected files: `web/simulator/src/pages/CandidatesPage.jsx`, `web/simulator/src/components/CandidateCard.jsx`, `web/simulator/src/components/CandidateEvidence.jsx`
- Validation: `npm run test:web`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T06-S04` 实现日线、年线和 BOLL 图表

- Status: `pending`
- Goal: 用 ECharts 展示截至模拟日的匿名走势和交易标记。
- Steps:
  - 桌面同时展示日线主图和年线副视图。
  - 手机使用日线、年线标签切换。
  - 日线包含 BOLL、成交量、去年最高价和首次突破点。
  - 支持触摸缩放、拖动、十字光标和横屏。
- Expected files: `web/simulator/src/charts/DailyChart.jsx`, `web/simulator/src/charts/YearlyChart.jsx`, `web/simulator/src/pages/TradePage.jsx`
- Validation: `npm run test:web && npm run build:web`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T06-S05` 实现账户和交易操作

- Status: `pending`
- Goal: 桌面和手机都能编辑多笔订单、完成决策和推进会话。
- Steps:
  - 展示现金、冻结资金、持仓、可卖数量和盈亏。
  - 实现买卖、修改、取消和必填交易理由。
  - 下单确认展示数量、预计金额、费用和冻结资产。
  - 手机使用底部固定交易操作区。
- Expected files: `web/simulator/src/components/PortfolioPanel.jsx`, `web/simulator/src/components/OrderEditor.jsx`, `web/simulator/src/components/MobileTradeBar.jsx`
- Validation: `npm run test:web`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T06-S06` 完成响应式和无障碍验收

- Status: `pending`
- Goal: 验证四种目标尺寸下核心流程可用。
- Steps:
  - 添加 `375x667`、`390x844`、`768x1024`、`1440x900` Playwright 项目。
  - 覆盖创建、候选、图表、下单、完成决策和推进流程。
  - 验证无核心横向滚动、触摸目标、焦点顺序和横屏图表。
  - 保存失败截图和 trace，不提交无关生成物。
- Expected files: `tests/e2e/simulator-responsive.spec.js`, `playwright.config.js`, `web/simulator/src/styles/`
- Validation: `npm run test:e2e`
- Commit: `pending`
- Notes:

### `TASK-20260712-1701-trading-simulator-T07` P2 复盘与最终验收

- Status: `pending`
- Depends on: `TASK-20260712-1701-trading-simulator-T06`
- Goal: 完成绩效、理由复盘、基准、实名揭晓、文档和完整端到端验收。
- Files likely touched: `src/simulator/application/reports.js`, `web/simulator/src/pages/ReviewPage.jsx`, `README.md`, `tests/`
- Validation: `npm run check && npm test && npm run test:web && npm run build:web && npm run test:e2e`

#### Subtasks

##### `TASK-20260712-1701-trading-simulator-T07-S01` 实现绩效和可选基准

- Status: `pending`
- Goal: 先生成账户绝对绩效；已有沪深300数据时增加基准，否则明确标记 TODO。
- Steps:
  - 计算总收益、年化、最大回撤、波动率、Sharpe 和 Sortino。
  - 计算已实现、未实现盈亏、费用、滑点、胜率、盈亏比和换手率。
  - 检测现有沪深300数据并允许启用；缺失时报告 `benchmark_unavailable`，不阻止复盘。
  - 对短会话、无成交和未平仓定义稳定输出。
- Expected files: `src/simulator/application/reports.js`, `tests/simulator-report.test.js`
- Validation: `node --test tests/simulator-report.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T07-S02` 实现交易练习复盘页

- Status: `pending`
- Goal: 将收益与当时候选、证据、理由和会话分支关联展示。
- Steps:
  - 展示权益、回撤、基准和费用图表。
  - 展示每笔订单的候选快照、证据、理由和成交差异。
  - 展示实名揭晓、盲测状态和父子会话关系。
  - 对未交易候选和未平仓持仓提供明确说明。
- Expected files: `web/simulator/src/pages/ReviewPage.jsx`, `web/simulator/src/components/PerformanceCharts.jsx`, `web/simulator/src/components/TradeReview.jsx`
- Validation: `npm run test:web && npm run build:web`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T07-S03` 完成端到端业务验收

- Status: `pending`
- Goal: 使用固定市场完成从创建到复盘的完整桌面和手机流程。
- Steps:
  - 创建 D 日收盘会话并生成匿名候选。
  - 提交多笔订单、完成决策、推进、成交或失效。
  - 验证 T+1 后卖出、结束估值、揭晓和 JSON 导出。
  - 验证克隆分支使用新配置且父会话不变。
- Expected files: `tests/e2e/simulator-flow.spec.js`, `tests/fixtures/simulator/`
- Validation: `npm run test:e2e`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T07-S04` 更新用户文档和 CLI 入口

- Status: `pending`
- Goal: 让本机用户能安装、启动、准备数据和排查问题。
- Steps:
  - 增加模拟器启动、构建、测试和数据库路径说明。
  - 增加历史数据预检、质量问题和回填恢复说明。
  - 增加匿名、盲测、手机端和数据隐私说明。
  - 如增加 `bin/x simulator`，同步 CLI help 和 smoke test。
- Expected files: `README.md`, `bin/x`, `tests/core.test.js`
- Validation: `bin/x doctor && npm run check && rg -n "simulator|匿名|盲测|手机" README.md`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T07-S05` 最终检查和任务收尾

- Status: `pending`
- Goal: 证明首版验收完成且提交范围干净。
- Steps:
  - 运行全部服务端、前端、构建和 E2E 验证。
  - 检查匿名泄漏、未来数据和数据版本冻结测试结果。
  - 检查工作区，区分本任务文件和用户既有变更。
  - 更新所有已完成任务状态、验证摘要和 commit hash。
- Expected files: `tasks/TASK-20260712-1701-trading-simulator.md`
- Validation: `npm run check && npm test && npm run test:web && npm run build:web && npm run test:e2e && git status --short`
- Commit: `pending`
- Notes:

### `TASK-20260712-1701-trading-simulator-T08` P3 历史数据准确性 TODO

- Status: `pending`
- Depends on: `TASK-20260712-1701-trading-simulator-T07`（非阻塞后续，需显式按 ID 执行）
- Goal: 在交易系统 MVP 可用后补齐精确历史 Universe、真实成交价格、公司行为、点时复权、历史规则和基准。
- Files likely touched: `src/simulator/data/`, `src/simulator/adapters/ledger/`, `fetch/`, `data/`, `tests/`
- Validation: `node --test tests/simulator-accurate-data-*.test.js && manual check: historical_accurate 数据门禁通过`

#### Subtasks

##### `TASK-20260712-1701-trading-simulator-T08-S01` 补齐历史证券主数据

- Status: `pending`
- Goal: 按日期返回沪深京当时有效证券，并包含后来退市股票。
- Steps:
  - 扩展北交所和历史代码识别。
  - 建设上市、退市、板块、名称和 ST 状态有效区间。
  - 接入东方财富和交易所公开来源并记录冲突。
  - 验证历史 Universe 不存在幸存者偏差。
- Expected files: `src/simulator/data/security_master.js`, `src/simulator/adapters/ledger/security_repository.js`, `tests/simulator-accurate-data-security.test.js`
- Validation: `node --test tests/simulator-accurate-data-security.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T08-S02` 增加不复权真实行情

- Status: `pending`
- Goal: 为成交、费用和涨跌停提供真实 OHLC 与前收盘。
- Steps:
  - 将现有 K 线接口复权参数显式化并保持旧默认兼容。
  - 新增 `fqt=0` 独立账本、校验、checkpoint 和失败队列。
  - 为 accurate 模式实现 `getRawBar`。
  - 小范围验证后再安排全历史回填。
- Expected files: `src/sources/eastmoney/client.js`, `fetch/fetch_kline.js`, `src/simulator/adapters/ledger/raw_kline_repository.js`, `tests/simulator-accurate-data-raw.test.js`
- Validation: `node --test tests/eastmoney-client.test.js tests/simulator-accurate-data-raw.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T08-S03` 补齐公司行为与点时复权

- Status: `pending`
- Goal: 防止模拟日之后的公司行为回写历史信号和图表。
- Steps:
  - 建设分红、送转、配股和拆合股记录及 `known_at`。
  - 计算点时前复权因子和内容版本。
  - 实现 accurate 图表和信号价格视图。
  - 验证未来公司行为不会改变历史输出。
- Expected files: `src/simulator/data/corporate_actions.js`, `src/simulator/data/point_in_time_adjustment.js`, `tests/simulator-accurate-data-adjustment.test.js`
- Validation: `node --test tests/simulator-accurate-data-adjustment.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T08-S04` 补齐历史状态、规则和费用

- Status: `pending`
- Goal: 按日期准确执行停牌、ST、板块涨跌停和费用规则。
- Steps:
  - 建设规则有效区间、来源和版本。
  - 实现新股、板块、ST、停牌、涨跌停、T+1和整手查询。
  - 实现佣金、印花税和过户费历史查询。
  - accurate 模式遇未知规则时拒绝启动。
- Expected files: `src/simulator/data/historical_rules.js`, `src/simulator/adapters/ledger/rule_repository.js`, `tests/simulator-accurate-data-rules.test.js`
- Validation: `node --test tests/simulator-accurate-data-rules.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T08-S05` 补齐基准和 accurate 数据门禁

- Status: `pending`
- Goal: 冻结精确数据版本，并让报告默认使用可验证沪深300基准。
- Steps:
  - 建设沪深300行情或收益序列账本。
  - 联合检查历史 Universe、原始行情、公司行为、规则和基准。
  - 冻结各账本内容摘要并验证会话恢复。
  - accurate 模式缺失关键数据时拒绝启动。
- Expected files: `src/simulator/data/accurate_data_gate.js`, `src/simulator/adapters/ledger/benchmark_repository.js`, `tests/simulator-accurate-data-gate.test.js`
- Validation: `node --test tests/simulator-accurate-data-gate.test.js`
- Commit: `pending`
- Notes:

##### `TASK-20260712-1701-trading-simulator-T08-S06` 执行精确数据全历史回填

- Status: `pending`
- Goal: 在全部适配器通过小范围验证后回填各来源全部可得历史。
- Steps:
  - 用 10 只证券和有限日期完成预演。
  - 分批运行并保存 checkpoint、失败队列和质量报告。
  - 重试失败项并记录无法补齐原因。
  - 代码提交和生成数据提交分开。
- Expected files: `runs/`, `data/`, `tasks/TASK-20260712-1701-trading-simulator.md`
- Validation: `manual check: historical_accurate 覆盖率和质量报告达到数据门禁要求`
- Commit: `pending`
- Notes:

## Deferred Work

- 自动策略接口和自动运行。
- 批量回测、参数扫描和结果对比。
- 公网部署、认证、多用户和权限。
- 分钟、Tick、融资融券、期权和期货。
