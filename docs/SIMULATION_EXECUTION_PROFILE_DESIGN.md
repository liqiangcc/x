# Simulation Execution Profile 设计

> 日期：2026-08-12  
> 更新：2026-08-13  
> 状态：已实现  
> 范围：`simulation_run_drawdown_buying` 使用的证券执行属性识别、ExecutionProfile 选择、买入执行模型边界，以及后续新增市场规则时的扩展方式。

## 1. 目标

把以下四个问题彻底分开：

1. **证券是什么、在什么有效期内具备什么交易资格**；
2. **Application 需要什么稳定证券元数据**；
3. **应该选择哪个 ExecutionProfile**；
4. **选定 Profile 后如何执行成交**。

核心原则：

> Security Master 保存事实与证据；SecurityMetadataReader 做稳定投影；SecurityExecutionProfileResolver 决定证券事实映射到哪个真实市场 Profile；BuyExecutionModelResolver 决定如何构造执行模型；ExecutionProfile 描述市场执行假设；Business Policy 决定为什么买。

当前主链路：

```text
Repository Security Master
      |
      v
SecurityMasterReader Port
      |
      | SecurityMasterRecord
      v
SecurityMetadataReader Port
      |
      | execution metadata
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

业务信号独立存在：

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
- lot size / tick size；
- 印花税、佣金、滑点；
- T+0 / T+1 settlement；
- 涨跌停、停牌等执行限制。

### 2.2 Security Master / SecurityMetadataReader

Security Master 是证券身份和资格事实的权威数据边界。详细契约见 `docs/SECURITY_MASTER_DESIGN.md`。

默认仓库链路：

```text
data/security_master/manifest.json
        ↓
LedgerSecurityMasterReader
        ↓ SecurityMasterRecord
LedgerSecurityMetadataReader
        ↓ execution metadata projection
Application
```

`SecurityMasterRecord` 保存：

```text
security.code / security.market
instrumentType
intradayRoundTripEligible
effectiveFrom / effectiveTo
source
qualityIssues[]
```

当前 `data/security_master/manifest.json` 通过显式 `universe_snapshot` record set 引用 `data/universe/20260701/stocks.json`，并在 manifest 中声明该 record set 的分类事实。这样不会复制数千只 A 股，也不会让 Adapter 通过代码号段推断类型。

未来 ETF 应作为有来源、有有效期、有明确 `intradayRoundTripEligible` 的 Security Master 数据进入；不能根据 `51xxxx`、`15xxxx`、名称包含 `ETF` 等启发式规则猜测。

`SecurityMetadataReader` 只暴露 Application 所需的窄能力：

```text
readMetadata(security, options?) -> metadata | null
```

`LedgerSecurityMetadataReader` 只依赖 `SecurityMasterReader Port` 并做投影，不读取文件、不解析 manifest、不知道 universe 结构，也不构造 concrete Security Master adapter。具体 wiring 由 Composition Root 完成。

### 2.3 SecurityExecutionProfileResolver

`src/ports/simulation/security_execution_profile_resolver.js` 定义：

```text
resolve({ security, metadata }) -> profileId
```

默认纯确定性映射：

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

证券身份和执行资格的基础校验由 `src/market/security_execution_metadata.js` 提供单一权威实现，Security Master 与 Resolver 复用，不再维护两套分类 Logic。

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

`domestic_stock_etf` 和 `t0_etf` 都携带质量声明，明确当前执行规则是研究用近似模型。证券是否真实具备 T+0 资格必须来自 Security Master / 显式 request metadata，再由 Resolver 映射；ExecutionModel、MCP Tool 和 Business Policy 都不得猜测。

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
KlineReader -> canonical security identity + normalized backtest endDate
      ↓
request.securityMetadata ?
      ├─ yes -> use request metadata
      └─ no  -> SecurityMetadataReader.readMetadata(
                   security,
                   { asOf: normalized backtest endDate }
                 )
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

自动选择以 KlineReader 返回的规范化 `endDate` 作为 Security Master 的 metadata cutoff，并通过 `{ asOf: endDate }` 查询该时点有效的证券事实。若该时点不存在有效记录，Reader 返回 `null`，Application fail closed；不得回退到回测结束日之后才生效的最新记录。因此历史模拟不会因为仓库后来新增了证券分类事实而产生未来信息泄漏。

当前 simulation 仍然是“一个回测请求选择一个 Profile”。如果 `effectiveFrom/effectiveTo` 在回测区间内部发生变化，现有单-profile simulation 不会按每个 signal / trade 日期动态切换 Profile；这属于后续独立 temporal execution-profile capability。本次只消除“回测结束日之后的 metadata 被读入”的时间穿越，不假装解决区间内部规则变化。

### 3.2 显式研究 override

显式传入：

```text
executionModel = legacy_a_share
executionModel = domestic_stock_etf
executionModel = t0_etf
executionModel = frictionless
```

Application 跳过 SecurityMetadataReader 和 SecurityExecutionProfileResolver，直接交给 `BuyExecutionModelResolver`。

该能力用于受控模型对比，不代表系统声明证券真实类别。

MCP schema 不给 `executionModel` 设置协议默认值，因为协议层默认值会抢先覆盖 Application 的自动选择语义。

## 4. 依赖边界

允许：

```text
Application -> SecurityMetadataReader Port
Application -> SecurityExecutionProfileResolver Port
Application -> BuyExecutionModelResolver Port
Portfolio   -> BuyExecutionModel Port

Composition Root -> LedgerSecurityMasterReader
Composition Root -> LedgerSecurityMetadataReader
Composition Root -> concrete SecurityExecutionProfileResolver
Composition Root -> concrete BuyExecutionModelResolver

LedgerSecurityMetadataReader -> SecurityMasterReader Port
LedgerSecurityMasterReader   -> SecurityMasterRecord Logic

BuyExecutionModelResolver -> ExecutionProfileCatalog
BuyExecutionModelResolver -> ProfiledBuyExecutionModel
BuyExecutionModelResolver -> explicitly exceptional model factories
ProfiledBuyExecutionModel -> shared simulator mechanisms
Catalog -> ExecutionProfile Port contract
```

禁止：

```text
Application -> SecurityMasterReader
Application -> LedgerSecurityMasterReader
Application -> LedgerSecurityMetadataReader
Application -> concrete SecurityExecutionProfileResolver
Application -> ExecutionProfileCatalog
Application -> concrete execution models

MCP Tool -> SecurityMasterReader / Ledger adapters
MCP Tool -> concrete SecurityExecutionProfileResolver
MCP Tool -> ExecutionProfileCatalog
MCP Tool -> concrete execution models

LedgerSecurityMetadataReader -> filesystem / manifest / universe
LedgerSecurityMetadataReader -> concrete LedgerSecurityMasterReader
LedgerSecurityMasterReader -> execution profile ids / ExecutionModel

Portfolio -> SecurityMetadataReader
Portfolio -> SecurityExecutionProfileResolver
Portfolio -> ExecutionProfileCatalog
Portfolio -> concrete execution models

SecurityExecutionProfileResolver -> storage/network/MCP/execution mechanics
Catalog -> execution flow implementation
Profile -> Business Policy
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
security identity / eligibility validation -> security_execution_metadata Logic
security fact schema / effective period     -> SecurityMasterRecord Logic
repository security facts                   -> LedgerSecurityMasterReader
application metadata projection             -> LedgerSecurityMetadataReader
security -> profile                         -> SecurityExecutionProfileResolver
market assumptions                          -> ExecutionProfileCatalog
profile validation                          -> ExecutionProfile contract
profile-backed flow                         -> ProfiledBuyExecutionModel
profile/model creation                      -> BuyExecutionModelResolver
fees                                        -> shared fill / fee mechanism
slippage                                    -> shared slippage mechanism
market blocking                             -> registered restriction mechanism
business trigger                            -> DrawdownBuyingPolicy
orchestration                               -> Application / Portfolio
protocol                                    -> MCP Adapter
```

任何新增证券类别不得在 Adapter、Application 或 Business Policy 中复制这些职责。

## 6. 新增证券类别 / 市场 Profile 的标准流程

先判断变化属于哪一层。

### 6.1 只是新增证券分类或资格数据

例如新增 ETF master 数据、某证券 T+0 eligibility：

1. 通过 Security Master 数据源同步事实；
2. 归一化为 `SecurityMasterRecord`；
3. 由 `SecurityMetadataReader` 投影成稳定 metadata；
4. 若已有 Profile 足够表达，不修改任何 ExecutionModel。

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

- Security Master Record 保存来源、有效期和质量信息；
- `SecurityMasterReader` 是独立 Port；
- `LedgerSecurityMasterReader` 可从 repository manifest 归一化 record set / explicit records；
- 显式记录优先于较粗粒度 record set；
- Reader 支持 `asOf` 查询，未知证券返回 `null`；
- Security Master 数据源路径不能逃逸 `dataRoot`；
- `LedgerSecurityMetadataReader` 只依赖 SecurityMasterReader Port，不访问 filesystem；
- `SecurityMetadataReader` 与 `SecurityExecutionProfileResolver` 都保持独立边界；
- ETF 缺少 `intradayRoundTripEligible` 时 fail closed；
- A-share / T+1 ETF / T+0 ETF 映射由纯 resolver 完成；
- Application 省略 `executionModel` 时走自动 metadata resolution；
- 自动 metadata resolution 使用规范化回测 `endDate` 作为 Security Master `asOf`；
- 回测结束日不存在有效 Security Master 记录时 fail closed，不回退到最新或未来记录；
- Application 显式传 `executionModel` 时完全绕过证券分类；
- `frictionless` 只作为显式研究 override；
- Legacy A-share、Domestic stock ETF、T+0 ETF 共享 `ProfiledBuyExecutionModel`；
- T+0 ETF 没有新增 concrete execution model class；
- MCP schema 不声明 `executionModel` 默认值；
- MCP 支持显式 `securityMetadata`，但不自己分类证券；
- architecture fitness test 禁止 Application/MCP 依赖 Security Master concrete adapter、metadata concrete adapter、catalog 或 execution model；
- Composition Root 是 concrete wiring 的唯一入口。

## 8. 下一阶段

Security Master 契约和读取边界已经建立，下一缺口不再是“如何分类”，而是“**如何持续保证 Security Master 数据本身可信**”。

优先进入：

```text
SecurityMasterSource / repository inputs
        ↓
SecurityMaster quality validator
        ↓
  schema / provenance
  effective-period overlap
  duplicate/conflict detection
  referenced-file integrity
  profile resolvability
        ↓
CI / doctor report
        ↓
后续 ETF metadata source adapter / sync pipeline
```

先建立确定性的质量校验能力，再接外部 ETF 数据源。这样外部来源、同步控制和数据规则仍能保持关注点分离，也避免错误 Security Master 数据直接影响自动 execution-profile 选择。
