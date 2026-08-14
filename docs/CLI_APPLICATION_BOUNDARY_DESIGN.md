# CLI / Application 边界重构设计

> 日期：2026-08-14  
> 分支：`refactor/cli-application-boundary`  
> 状态：设计草案，待评审  
> 目标：保持现有 CLI 合同不变，通过渐进迁移把 `bin/x` 从业务与基础设施实现中剥离，使 CLI、MCP、HTTP/Simulator、GitHub Actions 复用同一 Application / Business / Capability 边界。

## 1. 核心结论

本次重构解决的不是“文件太长”，而是 `bin/x` 同时承担多种变化原因：

```text
命令协议 / help / argv
+ 输出与退出码
+ 业务流程编排
+ retry / quality / job 状态控制
+ 文件 / Git / child_process
+ AWS / Huawei Cloud / Proxy
+ DB / scripts
+ 报告与数据账本操作
```

目标不是把一个大文件机械切成多个小文件，而是建立真正的分离点：

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

长期约束：

> **入口只负责翻译，Application 只负责流程，Business 只负责规则，Capability/Logic 只负责确定性计算，Port 只描述外部需求，Adapter 只连接外部世界。**

---

## 2. 为什么现在做

MCP 合入主线后，仓库已经出现清晰的新路径：

```text
src/adapters/mcp/
    -> src/application/
    -> src/business/ / capabilities
    -> src/ports/
    <- src/adapters/*
```

如果 CLI 继续通过 `bin/x` 直接组合业务、文件、Git、网络和云实现，就会长期保留两套架构：

```text
MCP -> Application -> Ports -> Adapters
CLI -> bin/x -> concrete implementations
```

这会导致同一能力出现多份实现，也会让 AI 无法稳定判断新逻辑应该进入 CLI、Application 还是底层模块。

因此 `bin/x` 是当前最值得治理的关注分离点。

---

## 3. 当前边界问题

### 3.1 协议、流程、基础设施集中

当前 `bin/x` 同时维护：

- `printUsage()`；
- `parseOptions()`；
- command family；
- `main()` 命令路由；
- stdout/stderr/exit code；
- fs/process/Git/cloud/proxy/db 等执行。

新增一个功能经常会修改同一个中心文件。

### 3.2 Command Handler 已经承担 Application 职责

`proxy`、`benchmark`、`daily`、`git` 等路径中存在：

- runtime 生命周期；
- deadline / loop；
- retry；
- report 写入；
- job/progress 状态；
- success/failure 判定；
- 数据提交。

这些不能全部视为 CLI concern。

### 3.3 `main()` 是集中式路由热点

当前通过连续 `if` 分发所有命令。路由本身不是业务问题，但它让所有 command family 在同一个修改点发生耦合。

### 3.4 不能用“移动到 legacy.js”假装解耦

禁止这种第一步：

```text
bin/x 2900 行
  -> src/adapters/cli/legacy.js 2800 行
  -> bin/x 20 行
```

虽然 `bin/x` 变短了，但职责和依赖没有改变，还会制造一次巨大机械 diff。

本设计采用**原地 Strangler Migration**：每迁移一个 command family，就从 `bin/x` 删除对应旧实现；最后自然收敛成薄入口。

---

## 4. 强制原则

### RULE-CLI-01：CLI 是 Adapter

CLI 与 MCP 一样属于系统外层。

最终 `bin/x` 只负责启动 CLI entry 和顶层异常退出，不拥有业务规则或外部资源实现。

### RULE-CLI-02：Command 只做协议翻译

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
直接执行 SQL
直接调用行情 API
直接决定 retry
直接计算指标
直接决定 quality / strategy / buy-sell 规则
直接拼装 Git 数据提交业务规则
```

### RULE-CLI-03：Application 不知道 CLI

`src/application/**` 不得依赖：

```text
src/adapters/cli/**
process.argv
console
TTY
help 文本
```

Application 输入输出必须可被 MCP / HTTP / Actions 复用。

### RULE-CLI-04：能力与业务继续分离

通用能力不得带 CLI 或具体策略语义。

禁止：

```text
CliKlineCalculator
CliRetryLogic
CliDailyPolicy
```

应使用真实业务或能力名称：

```text
KlineReader
RetryPolicy
RunDailyPipeline
CommitRunData
GenerateDailyReport
```

### RULE-CLI-05：逻辑与控制分离

纯计算/归一化只依赖内存输入输出；业务调用顺序属于 Application；CLI 只拥有终端协议控制。

CLI 可以拥有：

```text
argv
stdout/stderr
human/json presenter
exit code
help/version
CLI 专属的交互进程生命周期
```

### RULE-CLI-06：Composition Root 只做 wiring

`src/adapters/cli/composition_root.js` 可以知道具体 Adapter，但不能决定业务结果。

不要机械地给每个函数创建接口。只有 Application 需要隔离外部能力、替换实现或独立测试时才定义 Port。

### RULE-CLI-07：禁止 Command 相互调用

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

共享必须发生在 Application / Capability，而不是命令层。

### RULE-CLI-08：CLI 合同兼容优先

本轮不得顺手修改：

- command name；
- flag name；
- 默认值；
- JSON shape；
- stdout 核心字段；
- 正常/已知错误退出码；
- GitHub Actions 对 `bin/x` 的调用方式。

CLI UX 改动必须独立提交。

---

## 5. 目标结构

只增加必要边界，不建立重量级框架：

```text
bin/
  x                         # 最终薄入口

src/
  adapters/
    cli/
      entry.js              # 最终统一入口
      router.js             # 最终声明式路由
      options.js            # CLI 参数解析
      usage.js              # help
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

    mcp/
      ...

  application/
    market/
    analytics/
    strategy/
    simulation/
    # 仅按真实用例需要增加：
    reports/
    jobs/
    daily/
    operations/

  business/
    ...

  ports/
    ...
```

Application 不按 CLI 命令机械镜像，而按业务用例命名。

例如：

```text
x report daily      -> GenerateDailyReportUseCase
x git commit-data   -> CommitRunDataUseCase
x daily             -> RunDailyPipelineUseCase
```

---

## 6. 边界判断方法

### 6.1 应进入 Application 的逻辑

如果它回答：

```text
下一步执行什么？
失败后是否继续？
是否重试？
是否达到业务成功条件？
组合哪些能力？
写哪些运行记录？
使用哪一种业务策略？
```

就不应该留在 CLI。

### 6.2 应留在 CLI 的逻辑

如果它只回答：

```text
用户传了什么 flag？
输出 JSON 还是文本？
help 怎么展示？
错误写 stdout 还是 stderr？
稳定 Application Error 映射成什么退出码？
```

则属于 CLI Adapter。

### 6.3 何时需要 Port

不要因为看到 `fs` 就自动创建 Port。

当 Application 需要外部能力时，才定义稳定 Port，例如：

```text
GitRepository
RunRepository
KlineReader / Writer
ProcessRunner
CloudKlineExecutor
ProxyProvider
Clock（仅确定性时间测试需要时）
```

纯 CLI 技术细节无需 Port：

```text
console
process.argv
process.exitCode
TTY
help
```

---

## 7. 渐进迁移策略

### 总原则：原地绞杀，不建立第二套 legacy 大文件

迁移过程中允许 `bin/x` 暂时同时包含：

```text
已迁移 command 的 delegate
+ 尚未迁移的旧实现
```

但必须满足：

```text
每迁移一个 command family
=> 新路径成为唯一实现
=> bin/x 中对应旧函数立即删除
=> bin/x 单调变小
```

禁止长期保留 old/new 双实现。

---

## 8. Phase 0：建立 CLI 合同基线

在改代码前先锁住外部行为。

至少覆盖：

```text
bin/x --help
bin/x doctor
report daily 正常/错误输入
典型 JSON 输出
未知 command
关键 exit code
```

并盘点 GitHub Actions 中直接调用 `bin/x` 的路径。

测试关注：

```text
argv
stdout
stderr
exit code
```

不锁死内部函数实现。

---

## 9. Phase 1：第一条垂直切片 `report daily`

第一项实现不抽整个 Router，也不搬整个 `bin/x`。

只建立最小新路径：

```text
bin/x main()
   |
   | report daily
   v
src/adapters/cli/commands/report.js
   |
   v
GenerateDailyReportUseCase
   |
   v
shared report capability / ports
```

此阶段：

1. 先建立 `report daily` CLI contract test；
2. 创建最小 `src/adapters/cli/options.js`（仅在新路径真正需要时）；
3. 创建 `ReportCommand`；
4. 将报告流程暴露为 Application Use Case；
5. `ReportCommand` 使用 Fake Use Case 测试；
6. 在现有 `main()` 中把 `report` 分支改为 delegate；
7. 删除 `bin/x` 中旧 `commandReport` 实现；
8. 保持外部行为完全兼容。

为什么先选 report：

- 范围窄；
- 已有 `generateDailyReport` 能力；
- 不需要先解决 cloud/proxy/retry；
- 能验证 Command -> Application 的真实边界；
- 回归面小。

---

## 10. Phase 2：迁移低风险 command family

第一条切片稳定后，按 family 逐步迁移：

```text
doctor
run（read-only list/show/failures）
db
stats
simulator
```

此阶段不追求统一所有 handler 形式；只复用已经证明有价值的抽象。

当至少 3~5 个 family 迁移后，再判断是否值得引入统一 `router.js` / `usage.js`，避免提前设计一个尚未验证的 CLI framework。

---

## 11. Phase 3：迁移外部执行型命令

迁移：

```text
aws
proxy
benchmark
git
```

重点不是把代码从 `bin/x` 搬到 `commands/*.js`，而是分开：

```text
Application：业务流程与成功条件
Adapter：AWS / Proxy / Git / process 具体执行
CLI：参数与展示
```

例如 `git commit-data`：

```text
GitCommand
 -> CommitRunDataUseCase
 -> GitRepository Port
 <- GitCliAdapter
```

数据 pathspec、commit message 等业务规则不得由 CLI 拼装。

---

## 12. Phase 4：迁移 Kline family

包含：

```text
kline fetch
kline sync
kline aggregate-yearly
kline retry
kline retry-queue
kline sync-status
kline unlock
kline validate
kline freshness
```

优先复用现有：

```text
src/kline/
src/application/market/
src/ports/market/
src/adapters/ledger/
```

禁止为了 CLI 再建一套 Kline 业务实现。

Kline 迁移过程中重点识别：

```text
同步流程
重试策略
引擎选择
质量/新鲜度规则
数据访问
```

各自真实的变化原因，而不是按文件名硬拆。

---

## 13. Phase 5：最后迁移 `daily`

`daily` 是最高风险、最高价值的业务编排入口，最后迁移。

目标：

```text
DailyCommand
    |
    v
RunDailyPipelineUseCase
    |
    +-> ResolveUniverse
    +-> SyncKline
    +-> ValidateQuality
    +-> BuildStrategySignals
    +-> GenerateReport
    +-> RecordRun
    +-> Optional CommitData
```

上述子步骤只有在存在稳定分离点时才抽成独立 Use Case / Capability，不机械创建类。

`DailyCommand` 最终不得知道：

- failure batch 如何重试；
- progress 如何合并；
- quality 是否允许 partial；
- strategy universe 如何选择；
- commit pathspec 如何生成。

---

## 14. Phase 6：收口 CLI Shell

当业务 command family 都完成迁移后，再完成最后的协议收口：

```text
bin/x
 -> src/adapters/cli/entry.js
 -> src/adapters/cli/router.js
 -> command handlers
```

此时再把：

```text
main()
printUsage()
公共 option parsing
顶层 error presenter
```

从 `bin/x` 完整移出。

这样 `bin/x` 变薄是**迁移结果**，不是第一步制造出来的表面指标。

---

## 15. Command / Presenter / Error 边界

### Command

只做：

```text
CLI input -> Application request -> result
```

### Presenter

JSON / human 输出属于 CLI concern。

简单命令使用纯函数即可：

```js
formatHuman(result)
```

不要一开始创建复杂 Presenter 类层级。

### Error

Application 使用稳定错误 code，例如：

```text
invalid_arguments
data_not_found
data_incomplete
capability_unavailable
conflict
```

CLI 再映射成现有兼容的 message / stderr / exit code。

底层 `ENOENT`、`SQLITE_BUSY`、AWS stack、spawn stack 不应该成为稳定 CLI 业务契约。

---

## 16. Composition Root

允许：

```text
CLI composition root
 -> concrete adapters
 -> application use cases
 -> commands
```

禁止：

```text
if quality < threshold
if strategy === ...
if drawdown > ...
```

Composition Root 只决定“接哪个实现”，不能决定业务结果。

当 CLI/MCP/HTTP 的 wiring 真正出现重复后，再考虑抽 `src/bootstrap/`；当前不提前建立。

---

## 17. Architecture Fitness Rules

逐步进入测试/CI：

```text
FIT-CLI-01 最终 bin/x 只能依赖 CLI entry。
FIT-CLI-02 src/application/** 不得依赖 src/adapters/cli/**。
FIT-CLI-03 src/business/** 不得依赖 argv/console/CLI。
FIT-CLI-04 已迁移 CLI command 不得直接访问 data/ 路径。
FIT-CLI-05 已迁移 CLI command 不得直接依赖 SQLite/AWS/Proxy/Git 具体实现。
FIT-CLI-06 Command handler 之间不得互相 import。
FIT-CLI-07 同一确定性能力不得在 CLI 目录复制实现。
FIT-CLI-08 固定业务阈值不得进入 Command/Presenter/Router。
FIT-CLI-09 retry/quality/strategy 决策不得进入 CLI 协议层。
FIT-CLI-10 新增 CLI 功能前必须先确认是否已有 Application 能力。
```

早期用轻量 Node import/require 扫描即可，不引入重量级架构工具。

---

## 18. 测试策略

### CLI Contract Test

验证：

```text
argv
stdout
stderr
exit code
```

### Command Test

使用 Fake Use Case，验证：

```text
参数转换
调用次数
Presenter
错误映射
```

不访问真实网络/文件系统。

### Application Test

使用 Fake Port，验证：

```text
流程顺序
失败分类
retry
时间边界
质量门禁
```

不启动 CLI。

### Adapter Test

单独验证真实：

```text
Git
Ledger
SQLite
AWS
Proxy
Process
```

---

## 19. 复杂度控制

### 不机械建层

禁止：

```text
Controller -> Service -> Manager -> Facade -> UseCase -> Handler
```

没有独立变化原因就不需要新层。

### 有稳定分离点才抽象

满足任一条件再抽：

- 两个入口需要复用；
- 需要 Fake 实现独立测试；
- 外部实现可能替换；
- 存在独立业务规则变化；
- 当前模块明显混合两种变化原因。

### 不按行数判断职责

300 行职责单一的 Use Case 可能比十几个互相跳转的小类更容易维护。

### 迁移后立即删除旧路径

禁止长期双轨。

---

## 20. 与 MCP 的统一开发顺序

未来新增能力优先：

```text
Business Rule / Capability
 -> Application Use Case
 -> Ports / Adapters
 -> CLI / MCP / HTTP exposure
```

而不是：

```text
先在 bin/x 写功能
 -> 再复制给 MCP
```

CLI 重构的最终价值不是“代码更漂亮”，而是让新增入口不再复制业务实现。

---

## 21. 本阶段明确不做

- 不修改 CLI UX；
- 不引入 Commander/Yargs 只为减少 parser 代码；
- 不全仓库搬目录；
- 不重写 Kline/Strategy/Simulator 算法；
- 不给每个 fs/process 调用创建 Port；
- 不顺手升级技术栈；
- 不顺手重构 MCP；
- 不创建一个巨型 `legacy.js`；
- 不一次性生成所有 command handler。

---

## 22. 验收标准

### 第一条切片完成

```text
[ ] report daily CLI contract test 建立
[ ] ReportCommand 可用 Fake Use Case 测试
[ ] 报告业务流程不依赖 argv/console
[ ] bin/x 中旧 commandReport 删除
[ ] report daily 外部行为兼容
[ ] npm run check / npm test / CLI smoke 通过
```

### 中期完成

```text
[ ] 低风险 family 已逐步迁移
[ ] cloud/proxy/git 具体实现不在已迁移 Command 中
[ ] Kline CLI 复用共享 Application/Port
[ ] architecture rules 进入 CI
[ ] bin/x 持续单调缩小，无 legacy 大文件替代物
```

### 最终完成

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

## 23. ADR 摘要

### ADR-CLI-001：CLI 是外层 Adapter

协议变化不能改变业务实现。

### ADR-CLI-002：采用原地 Strangler Migration

每迁移一个 family 就删除 `bin/x` 中对应旧实现，不先整体搬到 legacy 文件。

### ADR-CLI-003：不机械创建 Port

只有 Application 真正需要隔离外部能力时创建 Port。

### ADR-CLI-004：架构重构与 CLI UX 变更分离

降低 GitHub Actions 和既有脚本回归风险。

### ADR-CLI-005：`daily` 最后迁移

先用小切片证明模式，再处理最大风险编排。

### ADR-CLI-006：禁止 Command 间调用

所有共享发生在 Application / Capability。

### ADR-CLI-007：薄 `bin/x` 是最终结果，不是第一步 KPI

避免为了行数好看制造巨大机械迁移。

---

## 24. 推荐下一项代码任务

设计评审通过后，只做第一条切片：

```text
report daily
```

顺序：

1. 建立现有 CLI contract test；
2. 明确现有 `generateDailyReport` 与报告业务边界；
3. 创建最小 Report Application Use Case；
4. 创建 `src/adapters/cli/commands/report.js`；
5. Fake Use Case 测试 Command；
6. 在现有 `bin/x main()` 中 delegate 到新 Command；
7. 删除旧 `commandReport`；
8. 运行全量 unit test + CLI smoke；
9. 评审这一个切片，再决定下一 family。

不要在这一步创建完整 Router，也不要批量生成所有命令目录。

---

## 25. 最终判断标准

不看 `bin/x` 减少了多少行，而看：

```text
新增 MCP/HTTP 入口是否无需复制 CLI 业务逻辑？
修改业务规则是否无需进入 CLI 目录？
修改 CLI 参数是否无需修改业务逻辑？
替换 Git/DB/Cloud 实现是否无需修改 Command？
Application 是否能完全脱离 CLI 测试？
同一能力是否只有一个权威实现？
```

这些答案都为“是”，才算真正完成关注点分离。
