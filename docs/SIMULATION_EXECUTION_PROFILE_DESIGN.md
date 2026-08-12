# Simulation Execution Profile 设计

> 日期：2026-08-12  
> 状态：已实现  
> 范围：`simulation_run_drawdown_buying` 使用的证券执行属性识别、ExecutionProfile 选择、买入执行模型边界，以及后续新增市场规则时的扩展方式。

## 1. 目标

把以下三个问题彻底分开：

1. **证券是什么、具备什么交易资格**；
2. **应该选择哪个 ExecutionProfile**；
3. **选定 Profile 后如何执行成交**。

核心原则：

> Business Policy 决定为什么买；SecurityExecutionProfileResolver 决定某证券应该使用哪个真实市场 Profile；BuyExecutionModelResolver 决定如何构造执行模型；ExecutionProfile 描述市场执行规则是什么。

当前主链路：

```text
Security identity
      |
      v
SecurityMetadataReader Port
      |
      v
SecurityExecutionProfileResolver Port
      |
      | profile id
      v
BuyExecutionModelResolver Port
      |
      +-----------------------------+
      |                             |
      v                             v
ExecutionProfileCatalog          Exceptional Model
      |                           (frictionless)
      v
ProfiledBuyExecutionModel
      |
      +-> lot validation
      +-> market restrictions
      +-> slippage
      +-> fill / fees
      +-> settlement availability
```

业务信号仍独立存在：

```text
DrawdownBuyingPolicy
      |
      | emits business signals
      v
BuyOnlyPortfolioSimulator
      |
      v
resolved BuyExecutionModel
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

- 证券是 A 股还是 ETF；
- ETF 是否具备 T+0 资格；
- 100 股还是 100 份为一手；
- tick size；
- 印花税；
- T+0 / T+1；
- 涨跌停/停牌执行限制；
- 滑点与佣金。

### 2.2 SecurityMetadataReader

`src/ports/market/security_metadata_reader.js` 定义窄接口：

```text
readMetadata(security) -> metadata | null
```

它只负责读取证券执行分类所需的元数据，不负责：

- 选择 ExecutionProfile；
- 构造 ExecutionModel；
- 执行成交；
- 运行投资策略。

当前默认实现：

```text
LedgerSecurityMetadataReader
  -> data/universe/summary.json
  -> data/universe/<date>/stocks.json
```

当前仓库 `hs-a` universe 只覆盖沪深 A 股，因此默认 Reader 只会对真实存在于该 snapshot 的证券返回：

```text
instrumentType: a_share
intradayRoundTripEligible: false
```

对于当前 universe 无法证明类型或资格的证券返回 `null`，不根据代码号段猜测 ETF，也不根据“ETF”名称猜测 T+0。

这意味着未来若仓库新增 ETF master/security metadata，应扩展 Reader/数据源，而不是把代码前缀判断塞进 Application、MCP 或 ExecutionModel。

### 2.3 SecurityExecutionProfileResolver

`src/ports/simulation/security_execution_profile_resolver.js` 只定义：

```text
resolve({ security, metadata }) -> profileId
```

默认纯确定性实现：

```text
instrumentType = a_share
  -> legacy_a_share

instrumentType = etf
intradayRoundTripEligible = false
  -> domestic_stock_etf

instrumentType = etf
intradayRoundTripEligible = true
  -> t0_etf
```

关键 fail-closed 规则：

- ETF 必须显式提供 `intradayRoundTripEligible: true|false`；
- 不完整 ETF 元数据不得自动推断；
- A 股不得声明 `intradayRoundTripEligible: true`；
- Resolver 不访问文件、数据库、网络；
- Resolver 不知道费用、滑点、成交、settlement 实现；
- Resolver 不知道 `frictionless`，因为 frictionless 是研究对照模型，不是证券类别。

因此证券分类与执行机制是两个独立变化轴。

### 2.4 ExecutionProfile

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

Profile 是市场执行假设，不拥有执行算法，也不包含证券识别或业务策略。

### 2.5 ExecutionProfileCatalog

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

`domestic_stock_etf` 携带质量声明：

```text
etf_profile_assumes_domestic_stock_etf_t_plus_one
etf_profile_does_not_cover_t_plus_zero_etf_categories
```

`t0_etf` 只表示“已确认具备交易所当日回转资格的 ETF”的执行 Profile，并携带：

```text
t0_etf_profile_requires_exchange_eligible_instrument
t0_etf_profile_uses_shared_a_share_market_restriction_approximation
```

证券是否具备 T+0 资格由 Security Metadata 边界提供证据，再由 `SecurityExecutionProfileResolver` 映射；`ProfiledBuyExecutionModel`、MCP Tool、DrawdownBuyingPolicy 都不得猜测。

截至 2026-08-12，上交所公开规则说明部分 ETF 品种支持当日回转，而并非所有 ETF 都统一为 T+0；具体证券资格应以交易所当前规则和证券属性为准。

### 2.6 ProfiledBuyExecutionModel

`src/simulation/execution/profiled_buy_execution_model.js` 是 profile-backed 市场执行的唯一通用流程实现。

它负责：

1. 将 Profile 与运行时 execution config 合并；
2. 找到 signal 后的下一交易 bar；
3. 应用 Profile 指定的市场限制规则；
4. 应用共享滑点模型；
5. 按 lot 计算可执行数量；
6. 调用共享 fill / fee 机制；
7. 根据 settlement Profile 计算可用日期；
8. 返回统一 execution metadata。

不得为 `legacy_a_share`、`domestic_stock_etf`、`t0_etf` 复制上述流程。

当前 settlement 通用表达：

```text
next_trading_day -> tPlusOne: true  -> availableDate = 下一交易日
same_day         -> tPlusOne: false -> availableDate = 成交当日
```

所以 `t0_etf` 不需要 T+0-specific execution class 或 settlement controller。

### 2.7 BuyExecutionModelResolver

`BuyExecutionModelResolver` 只做执行实现选择：

```text
public model/profile id
    |
    +-> profile exists -> ProfiledBuyExecutionModel(profile)
    |
    +-> exceptional factory exists -> exceptional model
```

普通市场差异优先进入 `ExecutionProfileCatalog`。

`frictionless` 保留为明确特殊模型，因为它是研究对照口径，不代表真实证券市场 Profile；它只能通过显式 `executionModel` override 选择，不由 `SecurityExecutionProfileResolver` 自动返回。

## 3. Application / MCP 选择语义

`SimulateDrawdownBuyingUseCase` 支持两种互斥语义。

### 3.1 自动选择

省略 `executionModel`：

```text
KlineReader -> canonical security identity
      ↓
request.securityMetadata ?
      ├─ yes -> use request metadata
      └─ no  -> SecurityMetadataReader.readMetadata(security)
      ↓
SecurityExecutionProfileResolver.resolve(...)
      ↓
BuyExecutionModelResolver.resolve(profileId)
      ↓
simulate
```

如果最终没有足够 metadata，必须失败并要求调用方提供 `securityMetadata` 或显式 `executionModel`，不能静默回退、不能根据代码前缀猜测。

返回结果显式记录：

```text
config.executionModel
config.executionModelSelection

meta.executionSelection
  mode: security_metadata | explicit_override
  profileId
  securityMetadataSource: request | reader | null
```

这样 AI/测试可以区分“自动识别结果”和“研究者主动覆盖”。

### 3.2 显式研究 override

显式传入：

```text
executionModel = legacy_a_share
executionModel = domestic_stock_etf
executionModel = t0_etf
executionModel = frictionless
```

Application 将跳过 SecurityMetadataReader 和 SecurityExecutionProfileResolver，直接交给 `BuyExecutionModelResolver`。

该能力用于受控模型对比，不代表系统声明证券真实类别。

例如在历史回测里把同一份 Kline 分别送入 T+1 ETF、T+0 ETF、frictionless 是执行假设对照；不能据此推断该 Kline 对应证券在现实中就是 ETF 或具有 T+0 资格。

MCP schema 不再给 `executionModel` 设置 `legacy_a_share` 默认值，因为协议层默认值会抢先覆盖 Application 的自动选择语义。

## 4. 依赖边界

允许：

```text
Application -> SecurityMetadataReader Port
Application -> SecurityExecutionProfileResolver Port
Application -> BuyExecutionModelResolver Port
Portfolio   -> BuyExecutionModel Port
Composition Root -> LedgerSecurityMetadataReader
Composition Root -> concrete SecurityExecutionProfileResolver
Composition Root -> concrete BuyExecutionModelResolver
BuyExecutionModelResolver -> ExecutionProfileCatalog
BuyExecutionModelResolver -> ProfiledBuyExecutionModel
BuyExecutionModelResolver -> explicitly exceptional model factories
ProfiledBuyExecutionModel -> shared simulator mechanisms
Catalog -> ExecutionProfile Port contract
```

禁止：

```text
Application -> LedgerSecurityMetadataReader
Application -> concrete SecurityExecutionProfileResolver
Application -> ExecutionProfileCatalog
Application -> concrete execution models
MCP Tool    -> LedgerSecurityMetadataReader
MCP Tool    -> concrete SecurityExecutionProfileResolver
MCP Tool    -> ExecutionProfileCatalog
MCP Tool    -> concrete execution models
Portfolio   -> SecurityMetadataReader
Portfolio   -> SecurityExecutionProfileResolver
Portfolio   -> ExecutionProfileCatalog
Portfolio   -> concrete execution models
SecurityExecutionProfileResolver -> storage/network/MCP/execution mechanics
Catalog     -> execution flow implementation
Profile     -> Business Policy
```

这些边界由 `tests/simulation-execution-boundary.test.js` 持续检查。

其中 `t0_etf` 仍是 profile-only extension 的架构验收样例：

```text
src/simulation/execution/t0_etf_buy_execution_model.js
```

不得出现。

## 5. 单一权威实现

当前职责唯一归属：

```text
security metadata read  -> SecurityMetadataReader Adapter
security -> profile     -> SecurityExecutionProfileResolver
market assumptions      -> ExecutionProfileCatalog
profile validation      -> ExecutionProfile contract
profile-backed flow     -> ProfiledBuyExecutionModel
profile/model creation  -> BuyExecutionModelResolver
fees                    -> shared fill / fee mechanism
slippage                -> shared slippage mechanism
market blocking         -> registered restriction mechanism
business trigger        -> DrawdownBuyingPolicy
orchestration           -> Application / Portfolio
protocol                 -> MCP Adapter
```

任何新增证券类别不得在 Adapter、Application 或 Business Policy 中复制这些职责。

## 6. 新增证券类别 / 市场 Profile 的标准流程

先判断变化属于哪一层。

### 6.1 只是新增证券分类或资格数据

例如新增 ETF master 数据、某证券 T+0 eligibility：

1. 扩展证券元数据数据源；
2. 由 `SecurityMetadataReader` 映射成稳定 metadata；
3. 若已有 Profile 足够表达，不修改任何 ExecutionModel。

### 6.2 需要一个新的 Profile

1. 确认 lot、tick、settlement、fee、restriction 语义；
2. 在 `ExecutionProfileCatalog` 新增 `defineExecutionProfile(...)`；
3. 在公共 model/profile id 契约中暴露稳定 id；
4. 必要时扩展 `SecurityExecutionProfileResolver` 的纯映射；
5. 补 Profile 与 Resolver 单测；
6. 补相同 Business Policy 下的 profile 对照测试；
7. 补 MCP schema / stdio E2E。

### 6.3 只有执行控制流程本质不同

只有当变化无法由 Profile 数据和现有通用 mechanism 表达，才考虑新的 exceptional ExecutionModel。

`t0_etf` 已证明：settlement 差异本身不需要复制 ExecutionModel。

## 7. 当前验收结果

当前已经验证：

- `SecurityMetadataReader` 与 `SecurityExecutionProfileResolver` 都是独立 Port；
- 默认 Ledger Reader 只基于真实 `hs-a` universe 声明 A-share，不猜 ETF；
- ETF 缺少 `intradayRoundTripEligible` 时 fail closed；
- A-share / T+1 ETF / T+0 ETF 映射由纯 resolver 完成；
- Application 省略 `executionModel` 时走自动 metadata resolution；
- Application 显式传 `executionModel` 时完全绕过证券分类；
- `frictionless` 只作为显式研究 override；
- Legacy A-share、Domestic stock ETF、T+0 ETF 仍共享 `ProfiledBuyExecutionModel`；
- T+0 ETF 没有新增 concrete execution model class；
- MCP schema 不再声明 `executionModel` 默认值；
- MCP 支持显式 `securityMetadata`，但不自己分类证券；
- real stdio E2E 同时覆盖自动 A-share 选择与四种显式执行模型对照；
- architecture fitness test 禁止 Application/MCP 依赖 concrete metadata reader、concrete security resolver、catalog 或 execution model；
- Composition Root 是 concrete wiring 的唯一入口。

## 8. 下一阶段

当前最大的剩余缺口已经从“Resolver 是否存在”变成“证券元数据是否足够完整”。

当前仓库只拥有 `hs-a` universe，因此下一阶段优先级应是：

```text
Security master / instrument metadata
        ↓
ETF instrument classification
        ↓
T+0 eligibility metadata with provenance/effective date
        ↓
LedgerSecurityMetadataReader
        ↓
SecurityExecutionProfileResolver
```

建议不要先增加更多代码号段判断。真正可扩展的下一步是建立一个**带来源、有效日期和资格字段的 Security Master 数据契约**，让证券分类成为可审计数据，而不是散落在代码中的启发式规则。
