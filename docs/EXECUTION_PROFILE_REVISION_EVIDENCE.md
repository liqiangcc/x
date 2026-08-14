# Execution Profile Revision Evidence

> 日期：2026-08-14  
> 状态：证据清单已建立；尚未提交 `data/execution_profiles/manifest.json` 真实 revision  
> 范围：为 Temporal Execution Assumptions Phase E 准备可审计的一手规则证据。本文只回答“哪些执行假设有足够证据进入 revision、哪些仍属于研究假设”，不改变 Business Policy、Security Master、MCP schema 或默认 simulation 路径。

## 1. 为什么先建立证据清单

`ExecutionProfileRevision` 已经具备稳定的数据契约、有效期、provenance、overlap/gap 校验和 Ledger Reader，但结构正确不等于历史事实正确。

最危险的错误不是 schema 失败，而是把今天的规则、券商参数或研究假设写进历史 revision，然后让回测看起来“时间一致”。因此，真实 manifest 必须在数据进入仓库前完成证据分级。

本文遵循一个硬约束：

> 没有一手证据支持的字段宁可保留为 research default / quality issue，也不伪装成官方历史规则。

## 2. 证据准入规则

真实 `ExecutionProfileRevision` 的事实字段必须满足：

1. **来源优先级**：交易所、财政部/税务总局、登记结算机构等官方或一手规则来源；第三方文章只能用于发现线索，不能作为最终 provenance。
2. **有效日期明确**：来源必须能支持 `effectiveFrom`；`effectiveTo` 只能来自明确废止/修订边界或完整的后续规则审计，不能因为“回测只到这里”而人为截断。
3. **历史规则不向前外推**：当前规则不能自动证明过去规则相同。
4. **产品事实与规则机制分离**：某只 ETF 是否具备当日回转资格属于 Security Master；`t0_etf` profile 只表达确认资格之后的执行机制。
5. **市场事实与研究假设分离**：券商佣金、最低佣金和滑点如果没有具体账户/券商合同证据，不作为统一市场规则写入官方 revision。
6. **允许显式未知**：证据不足时保持 coverage gap 或 quality issue，不用猜测补洞。

## 3. ExecutionProfile 字段归属

| 字段 | 事实类型 | 推荐来源 | 是否可作为官方 revision 事实 | 说明 |
| --- | --- | --- | --- | --- |
| `lotRules.buyLotSize` | 交易所申报规则 | SSE / SZSE 交易规则 | 是 | 需要按证券类别和有效期确认 |
| `priceRules.tickSize` | 交易所报价规则 | SSE / SZSE 交易规则 | 是 | A 股与基金的最小价位不同 |
| `settlement.sharesAvailable` | 交易/回转机制 | SSE / SZSE 交易规则 | 是，但需谨慎 | A 股可直接由规则确认；ETF 的具体 T+0 资格仍由 Security Master 决定 |
| `feeRules.stampDutyRate` | 国家税收规则 | 财政部 / 税务总局 | 是 | 模型当前按卖出侧征收，应与税制口径一致 |
| `feeRules.commissionRate` | 券商收费 / 研究参数 | 具体券商合同或模拟配置 | 否，不能当统一市场事实 | 交易所公开的是上限/收费框架，实际佣金依券商和客户而异 |
| `feeRules.minimumCommissionYuan` | 券商收费 / 研究参数 | 具体券商合同或模拟配置 | 否，不能当统一历史市场事实 | 当前系统默认值应明确为模拟假设 |
| `priceRules.slippageRate` | 模型假设 | 回测模型配置 | 否 | 不是交易所规则 |
| `restrictionRules.kind` | 内部机制选择器 | 代码架构 | 否 | 官方规则支持其底层限制事实，但该 enum 本身是内部抽象 |

这意味着一个可信的历史 revision **不必**把所有执行参数都填满。官方可验证字段进入 profile snapshot；券商依赖或研究依赖字段可继续由 simulation/executionConfig 提供，并通过 `qualityIssues` 明示其性质。

## 4. 已核验的一手来源

### 4.1 上海证券交易所：2006 年交易规则

官方归档：

- https://big5.sse.com.cn/site/cht/www.sse.com.cn/lawandrules/sselawsrules2025/repeal/rules/c/c_20120917_10785168.shtml

可支持的历史事实：

- 规则自 **2006-07-01** 起实施；
- 投资者买入证券，在交收前不得卖出，实行回转交易的品种除外；
- A 股不是当时列明的当日回转品种；
- 竞价交易买入股票、基金、权证，申报数量为 **100 股（份）或其整数倍**；
- A 股最小价格变动单位为 **0.01 元人民币**；
- 基金、权证最小价格变动单位为 **0.001 元人民币**。

该来源可以支持 2009 年上海市场 A 股的 lot、tick 和非当日回转执行事实。

### 4.2 深圳证券交易所：2006 年交易规则

官方页面：

- https://www.szse.cn/disclosure/notice/general/t20060515_499577.html

可支持的历史事实：

- 规则自 **2006-07-01** 起实施；
- 投资者买入证券，在交收前不得卖出，实行回转交易的品种除外；
- 当时规则列明债券、债券回购实行当日回转，B 股次交易日起回转，A 股不是当日回转例外；
- 竞价交易买入股票或基金，申报数量为 **100 股（份）或其整数倍**；
- A 股最小价格变动单位为 **0.01 元人民币**；
- 基金最小价格变动单位为 **0.001 元人民币**。

该来源与 SSE 规则相互独立地支持 `legacy_a_share` 在 2009 年沪深两市的主要交易机械事实，因此不需要通过证券代码前缀推断规则。

### 4.3 财政部 / 国家税务总局：2008-09-19 股票交易印花税改单边

官方页面：

- https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/200809/t20080919_76432.htm

明确事实：

- 自 **2008-09-19** 起；
- A 股、B 股股票交易印花税从买卖双方按 **1‰** 征收，调整为只向**出让方**按 **1‰** 征收；
- 受让方不再征税。

因此，对当前“买入型 portfolio + 卖出侧 stamp duty”模型来说，2009 年 A 股历史税率应是 `stampDutyRate: 0.001`，而不是当前模拟默认的 `0.0005`。

### 4.4 财政部 / 税务总局：2023-08-28 证券交易印花税减半

官方页面：

- https://www.mof.gov.cn/jrttts/202308/t20230828_3904235.htm

明确事实：

- 自 **2023-08-28** 起，证券交易印花税实施减半征收。

这说明把当前 `0.0005` 默认税率无条件用于 2009 年会产生时间穿越。要建立跨 2023 年的 revision，必须在税制 timeline 上保留这一变更边界。

### 4.5 上海证券交易所：券商佣金不是统一市场费率

官方投资者服务页面：

- https://one.sse.com.cn/onething/gptz/

当前公开口径显示券商交易佣金存在最高费率和最低收费框架。该信息可以证明“佣金是券商收费项”，但不能证明所有投资者、所有券商、所有历史时期都使用同一个 `commissionRate`。

因此：

- 当前 `commissionRate: 0.0003` 不应被标记成“交易所历史费率”；
- 当前 `minimumCommissionYuan: 5` 也不应直接扩展成跨历史时期的统一事实；
- 如果未来需要精确模拟某个真实账户，应建立独立的 broker/account fee assumption，而不是污染市场规则 revision。

## 5. 2009 年 `legacy_a_share` 覆盖评估

当前仓库的 canonical historical simulation 使用 2009 年数据窗口。针对这一窗口，已经有足够的一手证据确认以下事实：

```text
profileId = legacy_a_share

lotRules.buyLotSize = 100
priceRules.tickSize = 0.01
settlement.sharesAvailable = next_trading_day
feeRules.stampDutyRate = 0.001   # 卖出侧
```

其中：

- lot/tick/回转机制同时有 SSE 与 SZSE 2006 规则支持；
- 1‰ 卖方印花税由 2008-09-19 财政部/税务总局政策支持；
- 佣金、最低佣金、滑点仍应视为 simulation research assumptions。

### 5.1 仍不立即提交 manifest 的原因

虽然 **2009 年窗口内的字段事实已经足够明确**，但 revision 的 `effectiveTo` 必须表示规则真实失效/变更边界，而不是“我们的样本在某天结束”。

在写入第一条真实 revision 之前，还需要完成一个窄范围 amendment audit：

1. 从 2008-09-19 开始，核对 SSE 与 SZSE 后续交易规则修订记录；
2. 找到会影响 lot、tick、回转机制或相关 restriction 的第一个真实变更点；
3. 同时核对印花税下一次有效变更边界；
4. 以这些真实边界确定 `effectiveTo`。

在这个审计完成前，仓库继续保持 `data/execution_profiles/manifest.json` 缺失状态，由现有 validator 明确报告 `unconfigured`，优于制造一个看似完整但时间边界错误的历史 revision。

## 6. 当前静态默认与历史事实的差异

当前 simulator 默认执行参数包含：

```text
slippageRate = 0.001
commissionRate = 0.0003
minimumCommissionYuan = 5
stampDutyRate = 0.0005
```

其中只有 `stampDutyRate` 可以直接映射到国家税收规则；而且 `0.0005` 对 2009 年并不成立。其余三项属于研究/券商依赖假设，不能因它们存在于默认配置中，就反向解释为历史官方市场事实。

建议第一条真实 A 股 revision 将 quality issue 显式保留下来，例如：

```text
broker_commission_uses_simulation_default
minimum_commission_uses_simulation_default
slippage_uses_simulation_default
```

这些标签只是候选命名，真正落数据时应先固定统一 quality vocabulary，避免字符串随意增长。

## 7. ETF revision 的当前证据状态

当前证据不足以安全创建 profile-wide 的历史 ETF revision。

原因包括：

- 不同 ETF 类别的当日回转资格并不相同；
- 资格可能随产品类别、跨境标的和规则修订变化；
- 单只 ETF 的官方说明不能自动推广为全部 ETF 的历史有效期；
- T+0 资格应继续由 Security Master 的证券事实决定，而不是写入 profile 选择逻辑或代码前缀判断。

因此，ETF 的下一步不是复制 A 股 revision，而是按“产品资格时间轴 + profile 规则时间轴”分别补证据。

## 8. 与当前架构的关系

证据流保持四个变化轴独立：

```text
官方/一手规则证据
        |
        v
ExecutionProfileRevision
        |
        v
ExecutionProfileTimelineReader
        |
        +--------------------+
                             |
Security Master timeline ----+--> execution assumption timeline
                                      |
                                      v
                         TimelineBuyExecutionModelProvider
                                      |
                                      v
                           BuyExecutionModelResolver
```

禁止把证据采集变成以下捷径：

```text
当前 catalog -> 猜 effectiveFrom -> 历史 manifest
证券代码前缀 -> T+0/T+1 profile
默认 commission -> 官方历史费率
当前规则 -> 向过去回填 coverage gap
```

## 9. 下一步

下一次实现应只做 **2009 A 股 amendment boundary audit**：

1. 列出 SSE/SZSE 从 2006 规则到后续修订的明确生效日期；
2. 对 lot、tick、回转机制逐项确认在 2009 前后何时真正变化；
3. 与印花税 timeline 取交集，得到第一条 `legacy_a_share` revision 的真实有效区间；
4. 只有区间边界也有一手证据后，才提交 `data/execution_profiles/manifest.json`；
5. manifest 提交后先让现有 `Validate execution profile revisions` CI 过绿，再讨论 Phase E。

在这一步完成前，**不切换默认 automatic simulation，不创建伪造历史 revision，不修改 MCP schema**。
