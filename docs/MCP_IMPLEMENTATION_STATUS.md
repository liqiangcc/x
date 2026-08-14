# MCP 实施状态与合并收口

> 日期：2026-08-14  
> 分支：`feat/mcp-architecture-design`  
> 目标：记录 `docs/MCP_ARCHITECTURE_DESIGN.md` 从设计草案进入实际实现后的真实状态，避免目录、阶段与后续任务继续漂移。

## 1. 当前结论

MCP 已经从“架构设计”进入可运行实现阶段。当前实现遵守以下主依赖方向：

```text
MCP Adapter
    -> Application Use Case
        -> Business Policy / Domain Capability
            -> Port
                <- Infrastructure Adapter
```

MCP 仍然是外层 Adapter，不是第二套股票业务系统。

本文件记录**实现状态**；`docs/MCP_ARCHITECTURE_DESIGN.md` 继续记录设计原则和 ADR。两者出现目录或阶段差异时，以本文件和当前代码为实现事实，以架构设计中的强制边界规则作为约束。

## 2. 目录事实修正

设计草案早期示例使用：

```text
src/mcp/
```

实际实现采用：

```text
src/adapters/mcp/
  composition_root.js
  sdk_server.js
  stdio_entry.js
  tool_registry.js
  tool_result.js
  tools/
```

这是有意的架构收口：MCP 属于协议/控制适配器，因此放在 `src/adapters/mcp/` 比独立的 `src/mcp/` 更准确。

共享边界实际为：

```text
src/application/     Application Use Cases
src/business/        具体业务 Policy
src/analytics/       通用确定性分析逻辑
src/market/          市场领域对象/验证逻辑
src/simulation/      模拟能力与机制
src/ports/           稳定依赖接口
src/adapters/        Ledger / Strategy / MCP 等外部适配器
```

后续不得为了与早期目录示例一致而把 MCP 从 `src/adapters/mcp/` 搬回 `src/mcp/`。

## 3. Phase 状态

### Phase 0：边界准备 — 完成

已完成：

- Business / Capability / Logic / Control / Infrastructure 边界审计；
- Kline Reader Port 与 Ledger Adapter；
- Security Master Reader / Timeline Port 与 Ledger Adapter；
- Strategy / Signal Reader 边界；
- Application Use Case 层；
- MCP Adapter 与 Composition Root；
- Fake Port / Adapter / MCP contract 测试；
- 时间边界、Security Master、Execution Profile 的 fail-closed 设计与验证。

详见 `docs/MCP_PHASE0_BOUNDARY_AUDIT.md`。

### Phase 1：只读行情 + Analytics — 完成

当前 Tool：

```text
market_get_security
market_get_kline
market_get_summary
analytics_get_drawdowns
analytics_get_recovery_periods
analytics_get_bollinger
```

完成标准：

- MCP Tool 不直接访问 `data/` 或 SQLite；
- 行情/证券读取经过 Port；
- 数学计算不在 MCP Adapter 内；
- Tool 为只读、幂等；
- Security 查询支持 point-in-time `asOf`；
- 仅提供 code 且出现多市场歧义时 fail closed，不猜 market。

### Phase 2：策略 MCP — 完成

当前 Tool：

```text
strategy_list
strategy_get_candidates
strategy_explain_signal
```

策略 evidence 由现有策略/信号存储读取，MCP 不重新编译或解释策略算法。

### Phase 3：Simulation MCP — MVP 完成，继续演进

当前 Tool：

```text
simulation_run_drawdown_buying
```

当前实现已经分离：

```text
MCP Tool
  -> SimulateDrawdownBuyingUseCase
      -> DrawdownBuyingPolicy
      -> KlineReader Port
      -> Execution Profile Resolution
      -> Portfolio Simulation
```

业务规则如 `drawdownStep`、`trancheFraction`、`maxPurchases` 位于 Business Policy，而不是 MCP Handler。

历史执行规则继续通过 Execution Profile / Timeline 演进，不允许在 MCP Tool 中写证券代码前缀判断、T+0/T+1 猜测或费用规则。

### Phase 4：性能与能力注册 — 未开始/按需推进

暂不作为本次合并前置条件：

- capability catalog；
- response cache；
- MCP resources；
- 大结果 pagination/streaming 的统一抽象；
- 更细粒度 data revision。

只有真实性能或 Tool 数量需求出现后再推进，避免提前复杂化。

## 4. 合并前架构验收

本分支进入 `master` 前必须满足：

- [x] MCP 作为 Adapter，不承载股票算法；
- [x] Application 不解析 MCP protocol payload；
- [x] Ledger / SQLite 访问经 Adapter；
- [x] `market_get_security` 补齐 Phase 1 Tool 集；
- [x] Strategy MCP 复用已有 evidence；
- [x] Simulation 业务 Policy 与执行机制分离；
- [x] Security Master 与 Execution Profile 有独立验证；
- [x] CI 运行 syntax、unit tests、security master validation、execution profile validation、ETF coverage audit 与 CLI smoke；
- [ ] 当前收口提交对应 CI 成功；
- [ ] Draft PR 完成最终审查后再进入可合并状态。

## 5. 明确保留的后续分离点

这些是技术债观察点，不是本次合并阻塞项。

### 5.1 Composition Root 装配规模

当前 `src/adapters/mcp/composition_root.js` 负责 MCP 入口的完整 wiring，这是 Composition Root 的合理职责。

但当 CLI / HTTP 也开始直接复用新的 Application Use Cases 时，应抽出共享 bootstrap：

```text
src/bootstrap/
  market.js
  analytics.js
  strategy.js
  simulation.js

src/adapters/mcp/composition_root.js
src/adapters/http/...
src/adapters/cli/...
```

触发条件：**同一 Reader / Resolver / Use Case 的构造逻辑在两个以上入口重复。**

在触发之前不要为了形式提前拆分。

### 5.2 `SimulateDrawdownBuyingUseCase` 编排重量

当前 Use Case 合法地承担一个业务用例的编排，但已经组合：

- Kline 读取；
- Security Execution Profile 解析；
- Execution Timeline；
- Drawdown Buying Plan；
- signal -> order projection；
- Portfolio Simulation；
- Result projection。

未来第二个 Simulation Use Case 出现并重复 execution context 解析时，应抽取共享 Application Capability，例如：

```text
ResolveSimulationExecutionContext
BuildTimelineExecutionModelProvider
```

触发条件：**出现第二处相同 execution-profile/timeline 装配逻辑。**

不要把 Drawdown Buying Policy、Execution Model 和 MCP schema 合并成一个“万能模拟服务”。

### 5.3 `bin/x` 仍是独立的系统级复杂度热点

MCP 新架构不应继续反向依赖 `bin/x`。后续重构 CLI 时，应让 CLI 逐步成为新的 Application Use Case Adapter，而不是让 MCP 或 Application shell-out 到 `bin/x`。

目标关系：

```text
CLI ----+
HTTP ---+--> Application / Domain
MCP ----+
Actions-+
```

## 6. 合并后的分支策略

`feat/mcp-architecture-design` 已经超过单一“设计任务”的生命周期。合并后停止继续把无关功能长期堆在该分支。

建议后续使用短生命周期分支：

```text
feat/mcp-<capability>
feat/simulation-<capability>
refactor/cli-application-boundary
fix/<specific-problem>
```

每个分支只解决一个清晰变化原因，并以 `master` 为重新汇合点。

## 7. 决策

本次收口后的合并判断：

```text
架构方向：通过
MCP 只读边界：通过
能力/业务分离：通过
逻辑/控制分离：通过
Phase 1 Tool 完整性：通过
Phase 2：通过
Phase 3：MVP 通过
最终门禁：当前 HEAD CI 成功
```

CI 成功后，可将 Draft PR 更新为正式合并候选；不需要继续在本分支增加新功能。
