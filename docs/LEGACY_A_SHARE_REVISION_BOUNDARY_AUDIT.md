# Legacy A-Share Revision Boundary Audit

> 日期：2026-08-14  
> 状态：2009 canonical window 的第一段 evidence boundary 已确定  
> 结论：第一条 `legacy_a_share` 历史 revision 可保守覆盖 `2008-09-19..2011-02-27`；本步骤只完成边界审计，不提交 manifest，不切换 Phase E。

## 1. 审计目标

本审计只回答一个问题：

> 对当前 canonical 2009 A 股回测，为 `legacy_a_share` 建立第一条真实 `ExecutionProfileRevision` 时，哪一段日期可以由现有一手证据直接支持，而不把未审计的新规则版本向前或向后外推？

审计字段仅限当前 `ExecutionProfile` 真正拥有的执行假设：

```text
lotRules.buyLotSize
priceRules.tickSize
settlement.sharesAvailable
feeRules.stampDutyRate
restrictionRules.kind  # 内部机制映射，不作为外部事实本身
```

以下字段明确不用于确定官方规则边界：

```text
commissionRate
minimumCommissionYuan
slippageRate
```

它们仍属于 broker/account 或 simulation research assumptions。

## 2. 边界原则

这里采用 **evidence-version boundary**，而不是只在数值发生变化时才切 revision。

规则是：

1. 某字段的官方事实开始生效时，形成候选 `effectiveFrom`；
2. 任一组成证据源进入未经本轮审计的新版本时，当前 evidence revision 结束；
3. 下一版规则即使最终证明 lot/tick/T+1 数值未变，也应建立新的 provenance revision，再决定是否与前一段具有相同 profile snapshot；
4. 不因为 canonical 数据只覆盖 2009 年就人为把 `effectiveTo` 截在 2009 年；
5. 不因为当前规则仍相同就把 2009 revision 一直延长到今天。

这样 `effectiveTo` 表示“这组证据已经被审计到哪里”，不会制造伪连续性。

## 3. 上海证券交易所时间轴

### 3.1 2006 交易规则

官方归档：

- https://big5.sse.com.cn/site/cht/www.sse.com.cn/lawandrules/sselawsrules2025/repeal/rules/c/c_20120917_10785168.shtml

关键事实：

- 2006-07-01 起实施；
- 买入股票、基金、权证为 100 股（份）或其整数倍；
- A 股最小变动单位 0.01 元；
- 买入证券在交收前不得卖出，实行回转交易的品种除外；A 股不是当时列明的当日回转品种。

### 3.2 2007 第一次修订

上交所当前规则的官方修订沿革明确记录：

- 2007-04-24 第一次修订来源为《关于调整无价格涨跌幅限制股票申报价格范围的通知》；
- 下一次《交易规则》修订记录为 2012-12-14。

官方修订沿革：

- https://www.sse.com.cn/lawandrules/sselawsrules2025/stocks/exchange/c/c_20260424_10816482.shtml

2007 修订的主题是**无价格涨跌幅限制股票申报价格范围**，没有把本审计关注的 A 股 100 股买入单位、0.01 元 tick 或 A 股回转资格变成另一套值。

因此，对 2009 canonical 普通 A 股执行假设，SSE 侧没有比 2011-02-28 更早的证据版本中断点。

### 3.3 2012 修订

上交所 2012-12-14 的修订通知明确该批修订自 2013-01-01 起生效：

- https://www.sse.com.cn/lawandrules/sselawsrules/repeal/rules/c/c_20230418_5720138.shtml

这晚于本次由 SZSE 产生的保守截止边界，因此不会缩短第一条 combined `legacy_a_share` revision。

## 4. 深圳证券交易所时间轴

### 4.1 2006 交易规则

官方页面：

- https://www.szse.cn/disclosure/notice/general/t20060515_499577.html

关键事实：

- 2006-07-01 起实施；
- 买入股票或基金为 100 股（份）或其整数倍；
- A 股最小变动单位 0.01 元；
- 当时列明债券、债券回购实行当日回转，A 股不属于当日回转例外。

### 4.2 2011 修订形成下一证据版本边界

深交所官方《交易规则》（2011 年修订）解读明确：

- 2011 版是对 2006-07-01 实施版本的再次修订；
- 新版自 **2011-02-28** 正式施行；
- 修订以适应性调整为主，不涉及重大制度变更，并强调基本不改变现有投资者交易习惯。

官方解读：

- https://www.szse.cn/disclosure/notice/t20110118_500654.html

本审计不利用“没有重大制度变更”去猜测所有字段继续相同。相反，2011-02-28 被视为一个新的 provenance version boundary：

```text
old evidence version ends: 2011-02-27
new evidence version starts: 2011-02-28
```

如果后续要继续覆盖 2011 年以后，需要单独核验 2011 版的对应字段，再建立下一条 revision。

## 5. 股票交易印花税时间轴

### 5.1 2008-09-19：卖方单边 1‰

财政部 / 国家税务总局官方政策：

- https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/200809/t20080919_76432.htm

明确从 **2008-09-19** 起：

- A 股、B 股股权转让书据由买卖双方按 1‰ 征收；
- 调整为只向出让方按 **1‰** 征收；
- 受让方不再征税。

这是当前第一条候选 revision 的最晚起始边界，因此：

```text
effectiveFrom = 2008-09-19
```

### 5.2 2023-08-28：证券交易印花税减半

财政部 / 税务总局公告：

- https://www.mof.gov.cn/jrttts/202308/t20230828_3904235.htm

明确自 **2023-08-28** 起减半征收。

该税制变化远晚于 2011-02-28 的 SZSE provenance boundary，所以对第一条 revision 来说，税收规则不会成为更早的 `effectiveTo`。

## 6. 时间轴交集

三个证据域的关键区间：

```text
SSE A-share execution mechanics
  2006-07-01 ----------------------------> 2012/2013 next rule version boundary

SZSE A-share execution mechanics
  2006-07-01 ----------------> 2011-02-27
                               2011-02-28 new rule version

Stock stamp duty
  2008-09-19 ----------------------------------------------> 2023-08-27
  seller-only 1‰
```

取交集得到当前第一段最保守、可审计的 combined coverage：

```text
legacy_a_share revision #1

  effectiveFrom = 2008-09-19
  effectiveTo   = 2011-02-27
```

这完整覆盖 canonical 2009 回测区间，同时不跨越深交所尚未逐字段核验的 2011 新规则版本。

## 7. 第一条 revision 的候选事实快照

边界审计支持下面这组**市场/税收事实**：

```text
profileId = legacy_a_share
assetClass = a_share

settlement.sharesAvailable = next_trading_day
lotRules.buyLotSize = 100
priceRules.tickSize = 0.01
feeRules.stampDutyRate = 0.001
restrictionRules.kind = a_share_market
```

其中 `restrictionRules.kind` 是对既有 date/board-aware A 股限制机制的内部选择器，不应把这个 enum 本身描述成交易所原文。

第一条 revision **不应**把以下值写成官方历史事实：

```text
commissionRate = 0.0003
minimumCommissionYuan = 5
slippageRate = 0.001
```

如果 snapshot 中省略这些字段，现有 `ProfiledBuyExecutionModel` 会继续从 simulation executionConfig/defaults 获取研究参数；因此模型输出必须同时携带 quality issue，避免使用者把这些成本误认为官方历史值。

## 8. Provenance 处理

该 revision 的事实由多个一手来源共同支持：SSE、SZSE、财政部/税务总局。

当前 `ExecutionProfileRevision.source` 是单个：

```text
provider
document
version
collectedAt
```

因此真实 manifest 不应随意挑其中一个来源并假装它覆盖整个 snapshot。

在不扩大 revision contract 的前提下，推荐把本审计文档作为 **repository evidence bundle**：

```text
source.provider = repository_evidence_bundle
source.document = docs/LEGACY_A_SHARE_REVISION_BOUNDARY_AUDIT.md
source.version  = <commit SHA>
```

本文件内部再保留所有一手官方链接和边界推导。这样单个 revision 仍有稳定 provenance 入口，同时不会丢失多来源证据链。

如果未来大量 profile 都需要字段级多来源 provenance，再单独设计 `evidenceRefs[]`；当前不要为了一个 revision 提前扩大核心 contract。

## 9. 结论

当前已具备提交第一条真实 `legacy_a_share` revision 的必要证据条件：

```text
2008-09-19 .. 2011-02-27
```

但本步骤按照上一阶段约束只完成 boundary audit，**不在同一提交里创建 manifest**。

下一步应当是：

1. 固定第一条 revision 的 quality vocabulary；
2. 使用本审计文档作为 evidence bundle provenance；
3. 新建 `data/execution_profiles/manifest.json`，只写这一条有证据支持的 revision；
4. 运行现有 `Validate execution profile revisions` CI；
5. 验证 canonical 2009 区间无 execution-profile coverage gap；
6. 仍不切换 Phase E，直到这条真实数据链路在独立测试中通过。
