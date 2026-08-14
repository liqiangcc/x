# CLI / Application 边界重构设计

> 日期：2026-08-14  
> 分支：`refactor/cli-application-boundary`  
> 状态：设计草案，待评审  
> 目标：保持现有 CLI 合同不变，通过渐进迁移把 `bin/x` 从业务与基础设施实现中剥离，使 CLI、MCP、HTTP/Simulator、GitHub Actions 复用同一 Application / Business / Capability 边界。

## 1. 结论

这次重构不是“把大文件拆小”，而是解决 `bin/x` 同时承担多种变化原因的问题：

```text
CLI 协议 / argv / help / 输出 / exit code
+ Application 流程编排
+ retry / quality / job 状态
+ fs / Git / child_process
+ AWS / Huawei Cloud / Proxy / DB
```

目标架构：

```text
CLI Adapter ─┐
MCP Adapter ─┤
HTTP Adapter ├──> Application Use Cases
Actions ─────┘           |
                         +--> Business Policies
                         +--> Capabilities / Logic
                         +--> Ports
                                |
                                v
                             Adapters
```

核心原则：

> **入口只负责翻译，Application 只负责流程，Business 只负责规则，Capability/Logic 只负责确定性计算，Port 只描述外部需求，Adapter 只连接外部世界。**

---

## 2. 当前最主要的分离点

当前 `bin/x` 同时包含：

- `printUsage()` / `parseOptions()` / `main()`；
- 所有 command family；
- stdout / stderr / exit code；
- fs / Git / process；
- cloud / proxy / DB；
- retry / report / job progress / data commit 等流程。

因此现在真正需要分离的是：

```text
CLI Protocol
Application Control
Business Rules
Infrastructure Execution
```

而不是单纯按文件大小拆分。

特别禁止这种“伪重构”：

```text
bin/x 2900 行
  -> legacy.js 2800 行
  -> bin/x 20 行
```

这只移动代码，没有降低耦合。

---

## 3. 强制规则

### RULE-01：CLI 是 Adapter

最终 `bin/x` 只负责启动 CLI entry 和顶层异常退出。

### RULE-02：Command 只做协议翻译

允许：

```text
argv / flag 解析
CLI 必填检查
字符串 -> Application Request DTO
调用 Use Case
JSON / human 输出
Application Error -> exit code
```

禁止：

```text
直接读写业务数据
直接执行 SQL / Git / cloud / proxy
直接决定 retry / quality / strategy
直接计算指标
直接包含固定业务阈值
```

### RULE-03：Application 不知道 CLI

`src/application/**` 不得依赖：

```text
src/adapters/cli/**
process.argv
console
TTY
help 文本
```

### RULE-04：能力与业务分离

禁止：

```text
CliKlineCalculator
CliRetryLogic
CliDailyPolicy
```

使用真实业务/能力名称：

```text
KlineReader
RetryPolicy
RunDailyPipeline
CommitRunData
GenerateDailyReport
```

### RULE-05：Command 之间禁止调用

禁止：

```text
DailyCommand -> KlineCommand -> GitCommand
```

允许：

```text
DailyCommand -> RunDailyPipelineUseCase
KlineCommand -> SyncKlineUseCase
GitCommand   -> CommitRunDataUseCase
```

共享发生在 Application / Capability。

### RULE-06：Composition Root 只做 wiring

`src/adapters/cli/composition_root.js` 可以知道具体 Adapter，但不能包含业务判断。

### RULE-07：CLI 合同兼容优先

本轮不修改：

- command name；
- flag name；
- 默认值；
- JSON shape；
- stdout 核心字段；
- exit code；
- GitHub Actions 调用方式。

CLI UX 改动单独处理。

---

## 4. 最小目标结构

不建立重量级框架，只增加必要边界：

```text
bin/
  x                       # 最终薄入口

src/adapters/cli/
  entry.js                # 最终统一入口
  router.js               # 最终声明式路由
  options.js
  usage.js
  error_presenter.js
  composition_root.js
  commands/
    report.js
    run.js
    db.js
    stats.js
    simulator.js
    aws.js
    proxy.js
    benchmark.js
    git.js
    kline.js
    daily.js

src/application/
  ...                     # 按真实 Use Case 增加
```

Application 不按 CLI command 机械镜像。

例如：

```text
x report daily     -> GenerateDailyReportUseCase
x git commit-data  -> CommitRunDataUseCase
x daily            -> RunDailyPipelineUseCase
```

---

## 5. 怎么判断逻辑放哪里

### 放 Application

如果逻辑回答：

```text
下一步执行什么？
失败后是否继续？
是否重试？
是否达到业务成功条件？
组合哪些能力？
写哪些运行记录？
使用什么业务策略？
```

### 留 CLI

如果逻辑只回答：

```text
用户传了什么 flag？
输出 JSON 还是文本？
help 怎么展示？
错误写 stdout 还是 stderr？
Application Error 映射什么 exit code？
```

### 什么时候定义 Port

只有 Application 真正依赖外部世界时再定义，例如：

```text
GitRepository
RunRepository
KlineReader / Writer
ProcessRunner
CloudKlineExecutor
ProxyProvider
```

不要因为看到一个 `fs` 调用就机械创建接口。

---

## 6. 迁移方式：原地 Strangler

不建立第二个巨型 legacy 文件。

迁移期间允许 `bin/x` 暂时同时存在：

```text
已迁移 command 的 delegate
+ 尚未迁移的旧实现
```

但每迁移一个 family 必须：

```text
新路径成为唯一实现
-> 删除 bin/x 中对应旧函数
-> bin/x 单调缩小
```

薄 `bin/x` 是最终结果，不是第一步 KPI。

---

## 7. 实施顺序

### Phase 0：锁定 CLI 合同

先建立外部行为测试：

```text
bin/x --help
bin/x doctor
report daily 正常/错误输入
典型 JSON 输出
未知 command
关键 exit code
```

同时盘点 GitHub Actions 中对 `bin/x` 的直接调用。

测试只锁：

```text
argv / stdout / stderr / exit code
```

不锁内部函数。

### Phase 1：第一条垂直切片 `report daily`

不要先抽完整 Router，也不要批量生成所有 Command。

只建立：

```text
bin/x main()
   -> ReportCommand
   -> GenerateDailyReportUseCase
   -> shared capability / ports
```

顺序：

1. 建 `report daily` CLI contract test；
2. 明确现有 `generateDailyReport` 的业务边界；
3. 创建最小 Application Use Case；
4. 创建 `src/adapters/cli/commands/report.js`；
5. Command 用 Fake Use Case 测试；
6. `bin/x main()` delegate 到新 Command；
7. 删除旧 `commandReport`；
8. 保持外部行为不变。

选择 report 的原因：范围窄、已有能力、回归风险小，适合验证模式。

### Phase 2：低风险 family

逐步迁移：

```text
doctor
run（read-only）
db
stats
simulator
```

至少迁移 3~5 个 family 后，再决定是否值得统一 `router.js` / `usage.js`。

### Phase 3：外部执行型 family

迁移：

```text
aws
proxy
benchmark
git
```

目标分离：

```text
CLI：参数与展示
Application：流程与成功条件
Adapter：AWS / Proxy / Git / process 具体执行
```

### Phase 4：Kline family

迁移：

```text
fetch / sync / aggregate-yearly
retry / retry-queue
sync-status / unlock
validate / freshness
```

优先复用现有：

```text
src/kline/
src/application/market/
src/ports/market/
src/adapters/ledger/
```

禁止创建 CLI 专属 Kline 业务实现。

### Phase 5：最后迁移 `daily`

`daily` 是最高风险编排入口，最后处理。

目标：

```text
DailyCommand
    -> RunDailyPipelineUseCase
        -> ResolveUniverse
        -> SyncKline
        -> ValidateQuality
        -> BuildStrategySignals
        -> GenerateReport
        -> RecordRun
        -> Optional CommitData
```

只有存在真实稳定分离点时才继续拆子 Use Case，不机械建类。

### Phase 6：收口 CLI Shell

所有主要 family 迁移后，再把：

```text
main()
printUsage()
公共 option parsing
error presenter
```

移入 `src/adapters/cli/`，此时 `bin/x` 自然成为薄入口。

---

## 8. Architecture Fitness Rules

逐步加入测试/CI：

```text
FIT-01 最终 bin/x 只能依赖 CLI entry。
FIT-02 src/application/** 不得依赖 src/adapters/cli/**。
FIT-03 src/business/** 不得依赖 argv/console/CLI。
FIT-04 已迁移 Command 不得直接访问 data/ 路径。
FIT-05 已迁移 Command 不得直接依赖 SQLite/AWS/Proxy/Git 具体实现。
FIT-06 Command handler 之间不得互相 import。
FIT-07 同一确定性能力不得在 CLI 目录复制实现。
FIT-08 固定业务阈值不得进入 Command/Presenter/Router。
FIT-09 retry/quality/strategy 决策不得进入 CLI 协议层。
```

早期使用轻量 Node import/require 扫描即可，不引入重量级架构工具。

---

## 9. 测试边界

### CLI Contract Test

验证：

```text
argv / stdout / stderr / exit code
```

### Command Test

Fake Use Case：

```text
参数转换
调用次数
Presenter
错误映射
```

### Application Test

Fake Port：

```text
流程顺序
失败分类
retry
时间边界
质量门禁
```

### Adapter Test

单独验证真实：

```text
Git / Ledger / SQLite / AWS / Proxy / Process
```

---

## 10. 复杂度控制

禁止这种层级爆炸：

```text
Controller -> Service -> Manager -> Facade -> UseCase -> Handler
```

只有满足以下任一条件才增加抽象：

- 两个入口需要复用；
- 需要 Fake 实现独立测试；
- 外部实现可能替换；
- 存在独立业务规则变化；
- 当前模块明显混合两种变化原因。

同时：

- 不按行数判断职责；
- 不为每个 IO 创建 Port；
- 不长期保留 old/new 双实现；
- 不一次性生成所有 Command；
- 不顺手升级 CLI framework / 技术栈；
- 不顺手重构 MCP。

---

## 11. 验收标准

### 第一条切片

```text
[ ] report daily CLI contract test
[ ] ReportCommand 可用 Fake Use Case 测试
[ ] 报告业务流程不依赖 argv/console
[ ] bin/x 中旧 commandReport 删除
[ ] 外部行为兼容
[ ] npm run check / npm test / CLI smoke 通过
```

### 中期

```text
[ ] 低风险 family 已迁移
[ ] cloud/proxy/git 具体实现不在已迁移 Command 中
[ ] Kline CLI 复用共享 Application/Port
[ ] architecture rules 进入 CI
[ ] bin/x 持续缩小，无 legacy 大文件替代物
```

### 最终

```text
[ ] bin/x 为薄入口
[ ] daily 业务流程不在 CLI
[ ] Command 之间无调用链
[ ] CLI 不拥有数据/策略/retry 业务规则
[ ] CLI/MCP 对共享能力只有一个权威实现
[ ] CLI 合同保持兼容
[ ] 旧实现全部删除
```

---

## 12. ADR 摘要

- **ADR-CLI-001**：CLI 是外层 Adapter。
- **ADR-CLI-002**：采用原地 Strangler Migration，不创建巨型 legacy 文件。
- **ADR-CLI-003**：只有真实外部边界才定义 Port。
- **ADR-CLI-004**：架构重构与 CLI UX 变更分离。
- **ADR-CLI-005**：`daily` 最后迁移。
- **ADR-CLI-006**：禁止 Command 间调用。
- **ADR-CLI-007**：薄 `bin/x` 是最终结果，不是第一步 KPI。

---

## 13. 设计评审通过后的下一项代码任务

只做一个切片：

```text
report daily
```

完成后先评审这一个切片的边界，再决定下一 family，不批量推进。

最终判断标准不是 `bin/x` 减少多少行，而是：

```text
新增 MCP/HTTP 入口是否无需复制 CLI 业务逻辑？
修改业务规则是否无需进入 CLI 目录？
修改 CLI 参数是否无需修改业务逻辑？
替换 Git/DB/Cloud 实现是否无需修改 Command？
Application 是否能完全脱离 CLI 测试？
同一能力是否只有一个权威实现？
```

这些答案都为“是”，才算真正完成关注点分离。
