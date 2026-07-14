# 策略数据同步

## 目标

日常任务不再更新全市场全部 K 线。默认策略先使用本地完整年线历史筛选代码，再只同步该集合在目标交易日的日线，并在本地聚合更新年线。

默认规则为：4 个完整年度收盘价连续下降，当前年度等待首次收盘突破上一年度最高价。完整年度条件在同一自然年内稳定，因此不需要每天重新抓取全市场年线。

## 数据流

```text
当日市场代码清单
  -> 读取本地上一年度及更早的年线
  -> 年线连续下降预筛
  -> data/strategy-universe/<year>/year-decline-close-breakout/codes.json
  -> 仅对策略代码同步当日日线
  -> 本地将日线聚合为当年年线
```

`codes.json` 同时记录源代码数、入选数、缺少年线数和缺失代码。缺少年线的代码不会混入日常同步，后续应通过独立补数任务处理。

## 分层边界

- `src/kline/code_universe.js`：通用代码集合执行、并发、缓存和原子落盘，不包含选股规则。
- `src/strategies/year_decline.js`：多年连续下跌的纯规则判断。
- `src/strategies/year_decline_sync.js`：把策略规则接到历史年线读取端口，输出同步代码集合。
- `src/kline/aggregate_yearly.js`：将指定代码的日线聚合为当年 OHLCV 年线，不依赖任何策略。
- `bin/x`：只负责编排“策略选码 → 日线同步 → 年线聚合”。

以后增加策略时，只需实现新的策略选择器并复用代码集合与聚合能力，不需要修改 K 线抓取和存储机制。

## 网页编排

策略页面是同步入口。点击“同步最新数据”后，后端异步执行：

```text
策略配置
  -> 生成该策略的代码集合
  -> 同步集合内的最新日线
  -> 本地聚合当前年线
  -> 重建该策略的全量信号索引
  -> 清理数据统计缓存
```

网页轮询任务状态，刷新页面不会重复启动任务。同一时间全局只允许一个策略同步，避免多个任务同时写 K 线文件。运行引擎和并发数可通过 `SIMULATOR_SYNC_ENGINE`、`SIMULATOR_SYNC_CONCURRENCY` 配置。

当引擎为 `auto` 且策略入选代码少于 500 只时，编排层启用 `cn-fast`：先用一只股票快速预检本机国内出口；成功则整批使用 `local`，空响应或失败则整批切换到经过东方财富真实 K 线预检的国内代理池。国内出口全部不可用时快速失败，不再回退 AWS。阈值可通过 `SIMULATOR_SYNC_CN_FAST_THRESHOLD` 或命令行 `--cn-fast-threshold` 调整。显式指定引擎时不会被覆盖。

## 命令

日常同步默认启用策略范围：

```bash
bin/x daily --latest --period daily
```

只有维护或补齐基础数据时才显式使用全量模式：

```bash
bin/x daily --latest --period yearly --all-codes
```

策略参数变化或需要重算代码集合时：

```bash
bin/x daily --latest --period daily --force-strategy-codes
```

日线同步成功后会自动更新相同代码的当前年度年线，不再产生第二轮年线网络请求。GitHub 定时任务只运行 `daily` 周期。手动触发的 `yearly` 周期保留给全量历史补数。

也可以只运行通用聚合能力，不执行策略或网络同步：

```bash
bin/x kline aggregate-yearly data/strategy-universe/2026/year-decline-close-breakout/codes.json --date 20260713
```

## 数据统计页面

模拟器导航中的“数据”页面展示：

- 日线、年线文件代码数；
- 每个周期的最新日期和最新日期覆盖率；
- 最近 5 个数据日期的代码分布；
- 损坏或空数据文件数；
- 当前策略同步集合、源代码数和缺少年线数；
- 策略集合包含的代码。

统计接口为 `GET /api/data/status`，默认缓存 5 分钟。`GET /api/data/status?refresh=true` 强制重新扫描。

## 运维边界

- 年线历史基线仍需单独保证完整；否则新代码可能永远无法进入策略集合。
- 每年首个交易日前后应执行一次全量年线补齐，再重新生成策略集合。
- `--all-codes` 是基础数据维护入口，不应作为每日任务默认参数。
- 策略集合文件属于生成数据，由数据任务提交；不要手工编辑。
