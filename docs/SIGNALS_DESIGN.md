# 信号系统设计文档

> 日期：2026-07-02
> 适用范围：`x report daily`、后续每日候选报告和可解释信号扩展。

## 1. 目标

信号系统负责把 `data/pool`、`data/kline/daily`、`data/kline/yearly` 中的账本数据转换成可解释、可复盘、可扩展的候选股票报告。

核心原则：

- 先设计基础能力，再实现具体信号。
- 信号只做判断和解释，不读文件、不写报告、不提交数据。
- 数据质量和信号命中分开处理。
- 每个信号必须输出 `evidence`，方便复盘和调试。
- 新增信号应优先通过组合已有能力完成。

非目标：

- v0.2 不做实时盘中信号。
- v0.2 不做回测。
- v0.2 不接数据库。
- v0.2 不做可视化网页。

## 2. 分层架构

```text
数据加载层
  -> 特征层
  -> 基础能力层
  -> 具体信号层
  -> 评分排序层
  -> 报告输出层
```

建议目录：

```text
src/signals/
  daily.js
  context.js
  features.js
  registry.js
  score.js
  quality.js
  capabilities/
    index.js
    pool_membership.js
    first_cross.js
    ratio_compare.js
    trend_alignment.js
    window_extreme.js
  signals/
    pool.js
    breakout.js
    volume.js
    trend.js

src/reports/
  daily.js
```

数据流：

```text
pool files
  -> candidate seed
  -> load daily/yearly kline
  -> normalize rows
  -> build features
  -> run registered signals
  -> aggregate score and quality
  -> write report artifacts
```

## 3. 核心概念

`CandidateSeed` 是从 pool 文件中抽取出的候选基础信息。

```js
{
  date: "20260701",
  code: "600519",
  name: "贵州茅台",
  market: 1,
  pools: ["zt", "qs"]
}
```

`SignalContext` 是单只股票运行所有信号时使用的只读上下文。

```js
{
  date: "20260701",
  isoDate: "2026-07-01",
  code: "600519",
  name: "贵州茅台",
  market: 1,
  pools: ["zt", "qs"],
  dailyRows: [],
  yearlyRows: [],
  features: {},
  quality: {
    status: "ok",
    issues: []
  }
}
```

`SignalDefinition` 是具体信号定义。

```js
{
  id: "year_breakout",
  category: "price",
  capability: "first_cross",
  defaultScore: 25,
  params: {},
  evaluate(context, capabilityRunner) {}
}
```

`SignalResult` 是信号执行结果。

```js
{
  id: "year_breakout",
  category: "price",
  ok: true,
  score: 25,
  evidence: {},
  qualityIssues: []
}
```

## 4. 基础能力枚举

基础能力使用稳定枚举，具体信号引用能力和参数。

```js
const CapabilityType = Object.freeze({
  POOL_MEMBERSHIP: "pool_membership",
  VALUE_COMPARE: "value_compare",
  FIRST_CROSS: "first_cross",
  RATIO_COMPARE: "ratio_compare",
  TREND_ALIGNMENT: "trend_alignment",
  WINDOW_EXTREME: "window_extreme",
  WINDOW_AVERAGE: "window_average",
  SEQUENCE_PATTERN: "sequence_pattern",
  QUALITY_GATE: "quality_gate",
});
```

v0.2 必须实现：

- `POOL_MEMBERSHIP`：判断股票是否属于指定 pool。
- `VALUE_COMPARE`：参数化比较两个 feature 值。
- `FIRST_CROSS`：判断当前值是否首次上穿基准值。
- `RATIO_COMPARE`：判断当前值是否达到基准值的指定倍数。
- `TREND_ALIGNMENT`：判断多个趋势值是否满足顺序关系。
- `SEQUENCE_PATTERN`：参数化判断数组序列中的连续比较形态。
- `QUALITY_GATE`：判断数据是否足够支持信号。

v0.2 可预留但不必完整实现：

- `WINDOW_EXTREME`
- `WINDOW_AVERAGE`

## 5. 能力接口

所有能力统一输入、统一输出。

```js
function evaluateCapability(context, params) {
  return {
    ok: true,
    evidence: {},
    qualityIssues: []
  };
}
```

能力层职责：

- 解析 `params` 中引用的 feature 路径。
- 判断条件是否成立。
- 输出证据。
- 返回能力相关的数据质量问题。

能力层禁止：

- 读取文件。
- 写入报告。
- 修改 `context`。
- 直接决定最终 candidate 排名。

## 6. v0.2 内置信号

`limit_up_pool`

```text
capability: POOL_MEMBERSHIP
params.pool: zt
score: 50
```

`strong_pool`

```text
capability: POOL_MEMBERSHIP
params.pool: qs
score: 30
```

`limit_break_pool`

```text
capability: POOL_MEMBERSHIP
params.pool: zb
score: 15
```

`year_breakout`

```text
capability: FIRST_CROSS
score: 25
condition:
  previous_trading_day.high <= previous_year.high
  today.high > previous_year.high
```

`volume_expand`

```text
capability: RATIO_COMPARE
score: 20
condition:
  today.amount >= average_amount_20 * 1.5
```

`trend_confirmed`

```text
capability: TREND_ALIGNMENT
score: 15
condition:
  today.close > ma20 > ma60
```

`year_downtrend_reversal`

```text
capabilities:
  SEQUENCE_PATTERN:
    source: features.completedYears
    field: close
    order: latest
    transitions: 3
    comparator: lt
  VALUE_COMPARE:
    left: features.today.close
    right: features.currentYear.open
    operator: gt
score: 20
condition:
  最近 4 个已完成年度 close 形成 3 次连续下降
  报告日 close > 当前年度 open
```

## 7. year_breakout 精确定义

`year_breakout` 表示：今天最高价首次突破上一自然年的年线最高价。

判断公式：

```text
previous_trading_day.high <= previous_year.high
today.high > previous_year.high
```

字段来源：

- `today.high`：报告日期当天 daily kline 的最高价。
- `previous_trading_day.high`：daily kline 中报告日期前一条交易记录的最高价。
- `previous_year.high`：yearly kline 中上一自然年那条记录的最高价。

注意：

- 不硬匹配 `YYYY-12-31`。
- 应按 `row.date.slice(0, 4) === String(previousYear)` 查找上一自然年 yearly bar。
- 昨天等于去年高点不算突破；今天大于才算突破。
- 如果昨天已经大于去年高点，则今天不算“今天才突破”。

`evidence`：

```js
{
  today_date: "2026-07-01",
  today_high: 12.58,
  previous_trading_date: "2026-06-30",
  previous_trading_day_high: 11.93,
  previous_year: 2025,
  previous_year_high: 12.30,
  breakout_margin_pct: 2.28
}
```

## 8. Feature 设计

`features.js` 统一计算可复用特征，避免每个信号重复解析 K 线。

v0.2 features：

```js
{
  today: {
    date,
    open,
    close,
    high,
    low,
    volume,
    amount
  },
  previousTradingDay: {
    date,
    high,
    close,
    amount
  },
  previousYear: {
    year,
    date,
    high,
    close
  },
  completedYears: [
    { year, date, open, close, high, low, amount }
  ],
  currentYear: {
    year,
    open,
    close,
    open_source
  },
  ma20,
  ma60,
  averageAmount20
}
```

feature 缺失时不抛出流程级异常，而是记录 quality issue，由具体信号决定是否无法判断。

## 9. Quality Model

质量问题独立于信号未命中。

标准 issue：

```text
missing_daily_kline
missing_yearly_kline
missing_report_date_row
missing_previous_trading_day
missing_previous_year_bar
insufficient_history
invalid_kline
invalid_feature_value
missing_current_year_open
insufficient_yearly_history
```

candidate 质量状态：

```text
ok
recorded
failed
```

规则：

- 缺少支持某个信号的数据时，该信号 `ok=false`，并返回 quality issue。
- candidate 仍可进入报告，但 `data_quality` 应标记为非 `ok`。
- 报告级 `quality.json` 汇总所有 candidate 的质量问题数量。

## 10. 评分与排序

信号分数只由命中的信号贡献。

candidate 汇总字段：

```js
{
  rank: 1,
  date: "20260701",
  code: "600519",
  name: "贵州茅台",
  market: 1,
  score: 95,
  pools: ["zt", "qs"],
  signals: [],
  data_quality: "ok",
  reason: "limit_up_pool, year_breakout, volume_expand"
}
```

排序规则固定：

```text
score desc
year_breakout ok desc
year_downtrend_reversal ok desc
volume_expand ok desc
data_quality ok desc
code asc
```

## 11. 报告输出

`x report daily --date YYYYMMDD` 输出：

```text
reports/<YYYYMMDD>/candidates.json
reports/<YYYYMMDD>/candidates.csv
reports/<YYYYMMDD>/summary.md
reports/<YYYYMMDD>/quality.json
```

输出必须 deterministic：

- JSON 2 空格缩进。
- 字段顺序固定。
- candidates 排序固定。
- 不写入当前时间。
- 不写入随机值。

## 12. 扩展规则

新增信号流程：

1. 确认是否能复用已有 capability。
2. 如不能复用，先新增 capability，而不是直接写特殊逻辑。
3. 在 `src/signals/signals/<name>.js` 定义信号。
4. 在 `registry.js` 注册。
5. 添加 fixture 和单元测试。
6. 确保输出 `evidence` 和 quality issues。

信号模块必须保持纯函数，不访问文件系统。

## 13. 测试计划

`year_breakout`：

- 今天突破、昨天未突破，触发。
- 昨天已经突破，不触发。
- 今天等于去年高点，不触发。
- 昨天等于去年高点、今天大于去年高点，触发。
- yearly 日期是 `YYYY-12-29/30/31` 都能识别。

`features`：

- 正确选择报告日行。
- 正确选择前一交易日。
- 正确选择上一自然年 yearly bar。
- 正确计算 MA20、MA60、前 20 日平均成交额。

`quality`：

- 缺 daily。
- 缺 yearly。
- 缺报告日行。
- 缺上一交易日。
- 缺上一年 yearly bar。
- 历史不足。

`report daily`：

- JSON 输出稳定。
- CSV 转义正确。
- Markdown 摘要稳定。
- candidate 排序稳定。
- quality 汇总正确。

## 14. v0.2 验收标准

完成后应满足：

```bash
npm run check
npm test
bin/x report daily --date 20260701
```

并生成：

```text
reports/20260701/candidates.json
reports/20260701/candidates.csv
reports/20260701/summary.md
reports/20260701/quality.json
```

其中：

- `year_breakout` 使用“今天才突破去年年线高点”的定义。
- 每个命中信号都有 `evidence`。
- 缺数据不会导致整个报告失败。
- 重复运行同一日期不产生无意义 diff。
