# Simulation Execution Profile 设计

> 日期：2026-08-12  
> 状态：已实现  
> 范围：`simulation_run_drawdown_buying` 当前使用的买入执行模型边界，以及后续新增市场执行规则时的扩展方式。

## 1. 目标

将“交易执行流程”和“市场/资产类别的执行规则”分离，避免每增加一种证券或结算规则就复制一套 ExecutionModel。

核心原则：

> Business Policy 决定为什么买；ExecutionModel 决定如何执行；ExecutionProfile 描述某类市场执行规则是什么。

因此：

```text
DrawdownBuyingPolicy
        |
        | emits business signals
        v
BuyOnlyPortfolioSimulator
        |
        v
BuyExecutionModel Port
        |
        v
BuyExecutionModelResolver
        |
        +-----------------------------+
        |                             |
        v                             v
ExecutionProfileCatalog          Exceptional Model
        |                         (frictionless)
        v
ProfiledBuyExecutionModel
        |
        +-> lot validation
        +-> market restrictions
        +-> slippage
        +-> fill / fees
        +-> settlement availability
```

## 2. 关注点分离

### 2.1 Business Policy

`DrawdownBuyingPolicy` 只负责：

- 首次买入触发条件；
- 回撤步长；
- 每次资金比例；
- 最大买入次数；
- 生成业务 signal。

它不得知道：

- 100 股还是 100 份为一手；
- tick size；
- 印花税；
- T+0 / T+1；
- 涨跌停/停牌执行限制；
- 滑点与佣金。

### 2.2 ExecutionProfile

`src/ports/simulation/execution_profile.js` 定义稳定的纯数据契约：

```text
ExecutionProfile
  id
  assetClass
  kind
  ruleApproximation
  settlement
    sharesAvailable
  lotRules
    buyLotSize
  priceRules
    tickSize
    slippageRate?
  feeRules
    commissionRate?
    minimumCommissionYuan?
    stampDutyRate?
  restrictionRules
    kind
  qualityIssues[]
```

Profile 是市场执行假设，不拥有执行算法，也不包含业务策略。

### 2.3 ExecutionProfileCatalog

`src/simulation/execution/execution_profile_catalog.js` 是 profile 数据的单一来源。

当前注册：

```text
legacy_a_share
  assetClass: a_share
  buyLotSize: 100
  tickSize: 0.01
  sharesAvailable: next_trading_day
  restrictionRules: a_share_market

domestic_stock_etf
  assetClass: domestic_stock_etf
  buyLotSize: 100
  tickSize: 0.001
  sharesAvailable: next_trading_day
  stampDutyRate: 0
  restrictionRules: a_share_market

t0_etf
  assetClass: t0_eligible_etf
  buyLotSize: 100
  tickSize: 0.001
  sharesAvailable: same_day
  stampDutyRate: 0
  restrictionRules: a_share_market
```

`domestic_stock_etf` 明确是境内股票 ETF 的近似 profile，并携带质量声明：

```text
etf_profile_assumes_domestic_stock_etf_t_plus_one
etf_profile_does_not_cover_t_plus_zero_etf_categories
```

`t0_etf` 是“已经确认具备交易所当日回转资格的 ETF”的执行 profile，而不是证券分类器。它携带：

```text
t0_etf_profile_requires_exchange_eligible_instrument
t0_etf_profile_uses_shared_a_share_market_restriction_approximation
```

因此：

```text
security -> 是否具备 T+0 资格
```

这个判断不得由 `ProfiledBuyExecutionModel`、MCP Tool 或 DrawdownBuyingPolicy 猜测。当前调用方必须在已确认标的资格后显式选择 `t0_etf`；未来若自动选择，应通过独立的 SecurityProfile / ExecutionProfileResolver 能力完成。

截至 2026-08-12，上交所公开规则说明部分 ETF 品种支持 T+0，例如债券 ETF、黄金 ETF、跨境 ETF、货币 ETF，而股票 ETF 实施 T+1；ETF 二级市场最低交易单位为 100 份，最小价格变动单位为 0.001 元。具体证券是否具备当日回转资格仍应以交易所当前规则和标的属性为准，不能仅凭“ETF”类型推断。

参考：

- 上海证券交易所《上海证券交易所交易规则（2026年修订）》：https://www.sse.com.cn/lawandrules/sselawsrules2025/stocks/exchange/c/c_20260424_10816482.shtml
- 上海证券交易所 ETF 常见问题：https://etf.sse.com.cn/fund/quertion/

### 2.4 ProfiledBuyExecutionModel

`src/simulation/execution/profiled_buy_execution_model.js` 是 profile-backed 市场执行的唯一通用流程实现。

它负责：

1. 将 profile 与运行时 execution config 合并；
2. 找到 signal 后的下一交易 bar；
3. 应用 profile 指定的市场限制规则；
4. 应用共享滑点模型；
5. 按 lot 计算可执行数量；
6. 调用共享 fill / fee 机制；
7. 根据 settlement profile 计算可用日期；
8. 返回统一 execution metadata。

不得为 `legacy_a_share`、`domestic_stock_etf`、`t0_etf` 等 profile 复制上述流程。

当前 settlement 已能通用表达：

```text
next_trading_day -> tPlusOne: true  -> availableDate = 下一交易日
same_day         -> tPlusOne: false -> availableDate = 成交当日
```

所以加入 `t0_etf` 不需要新增 T+0-specific execution class 或 settlement controller。

### 2.5 Resolver

`BuyExecutionModelResolver` 只做实现选择：

```text
public model id
    |
    +-> profile exists -> ProfiledBuyExecutionModel(profile)
    |
    +-> exceptional factory exists -> exceptional model
```

普通市场差异优先进入 `ExecutionProfileCatalog`。

`frictionless` 目前保留为明确的特殊模型，因为它是研究对照口径，不代表真实证券市场 profile；不能为了形式统一而让它继承真实市场限制、费用或结算假设。

## 3. 依赖边界

允许：

```text
Application -> BuyExecutionModelResolver Port
Portfolio   -> BuyExecutionModel Port
Resolver    -> ExecutionProfileCatalog
Resolver    -> ProfiledBuyExecutionModel
Resolver    -> explicitly exceptional model factories
ProfiledBuyExecutionModel -> shared simulator mechanisms
Catalog     -> ExecutionProfile Port contract
```

禁止：

```text
Application -> ExecutionProfileCatalog
Application -> concrete execution models
MCP Tool    -> ExecutionProfileCatalog
MCP Tool    -> concrete execution models
Portfolio   -> ExecutionProfileCatalog
Portfolio   -> concrete execution models
Catalog     -> execution flow implementation
Profile     -> Business Policy
Resolver    -> per-market compatibility wrappers
```

这些边界由 `tests/simulation-execution-boundary.test.js` 持续检查。

其中 `t0_etf` 作为 profile-only extension 的架构验收样例，CI 明确守卫：

```text
src/simulation/execution/t0_etf_buy_execution_model.js
```

不得出现。若未来出现该类文件，说明市场 profile 又开始复制执行流程，架构测试应直接失败。

## 4. 单一权威实现

当前必须保持：

```text
market assumptions      -> ExecutionProfileCatalog
profile validation      -> ExecutionProfile contract
profile-backed flow     -> ProfiledBuyExecutionModel
fees                    -> shared fill / fee mechanism
slippage                -> shared slippage mechanism
market blocking         -> registered restriction mechanism
business trigger        -> DrawdownBuyingPolicy
orchestration           -> Application / Portfolio
protocol                 -> MCP Adapter
```

任何新增证券类别都不得在 Adapter、Application 或 Business Policy 中复制这些职责。

## 5. 新增市场 Profile 的标准流程

对于可以使用现有通用执行流程的新市场规则，标准流程已经由 `t0_etf` 实际验证：

1. 确认其 lot、tick、settlement、fee、restriction 语义；
2. 在 `ExecutionProfileCatalog` 新增一个 `defineExecutionProfile(...)`；
3. 若需要新的通用市场限制类型，先增加一个独立 restriction mechanism，并在通用执行器的 restriction registry 注册；
4. 在公共 `BuyExecutionModelResolver` Port 中决定是否暴露新的稳定 model id；
5. 补 profile contract/catalog 单测；
6. 补同一 Business Policy 下不同 profile 的对照测试；
7. 补 MCP schema / stdio E2E，确认协议只是暴露 resolver 的选择，不拥有实现。

`t0_etf` 本次落地严格遵循该流程，没有新增：

```text
createT0EtfBuyExecutionModel()
t0_etf_buy_execution_model.js
```

只有当某种执行机制无法由当前 profile 数据和通用 mechanism 表达，并且其控制流程本质不同，才考虑新的 exceptional ExecutionModel。

## 6. 当前验收结果

当前实现已经验证：

- Legacy A-share 行为保持；
- Domestic stock ETF T+1 行为保持；
- T+0 ETF 通过同一 `ProfiledBuyExecutionModel` 执行；
- T+0 与 T+1 ETF 在相同输入下共享成交日、价格、数量和费用流程；
- T+0 ETF 的 `availableDate` 为成交当日，T+1 ETF 为下一交易日；
- T+0 ETF 没有新增 concrete execution model class；
- T+0 profile 显式声明必须先确认交易所资格，并声明市场限制模型仍为共享 A-share approximation；
- Frictionless 对照模型保持；
- 同一 DrawdownBuyingPolicy 在不同 ExecutionModel 下产生相同业务 signals；
- MCP schema 已暴露 `t0_etf`，但不拥有 T+0 判断或执行算法；
- real stdio E2E 对 Legacy / T+1 ETF / T+0 ETF / Frictionless 使用同一账本数据执行对照；
- MCP / Application / Portfolio 不依赖 profile catalog；
- resolver 不依赖 Legacy/ETF compatibility wrapper；
- profile contract 对非法 settlement、lot、tick、fee、restriction fail closed；
- catalog 对重复 profile id fail closed；
- profile 对象及嵌套规则不可变；
- CI architecture fitness test 覆盖依赖边界。

## 7. 后续演进

下一阶段不应继续手工增加“某代码 -> 某 profile”的业务分支。优先增加一个独立的证券执行属性边界：

```text
SecurityExecutionProfileReader / Resolver
        |
        v
security metadata / exchange classification
        |
        v
recommended ExecutionProfile id
```

它只负责回答“这个证券应该使用哪个执行 profile”，不负责执行成交，也不负责投资策略。

推荐顺序：

```text
ExecutionProfile contract/catalog
        ↓
更多真实市场 profile
        ↓
Security -> ExecutionProfile eligibility/resolution
        ↓
必要时扩展通用 restriction / fee / settlement mechanisms
        ↓
最后才考虑新的 exceptional ExecutionModel
```

这样可以把“证券分类/资格变化”和“成交执行流程变化”进一步拆开，继续满足关注点分离与单一职责原则。
