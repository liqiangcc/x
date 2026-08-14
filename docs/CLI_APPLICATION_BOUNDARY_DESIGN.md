# CLI / Application 边界重构设计

> 日期：2026-08-14  
> 分支：`refactor/cli-application-boundary`  
> 状态：设计草案，待评审  
> 目标：在保持现有 `bin/x` 命令、参数、输出和退出码兼容的前提下，把 CLI 从业务与基础设施实现中剥离，使 CLI、MCP、HTTP/Simulator、GitHub Actions 可以复用同一 Application / Business / Capability 边界。

## 1. 结论

这次重构**不做大爆炸式重写，也不以“把大文件拆小”为目标**。

真正要解决的问题是：当前 `bin/x` 同时承担了多种变化原因：

```text
命令协议
+ 参数解析
+ help / stdout / stderr / exit code
+ 流程编排
+ 业务规则
+ 文件读写
+ Git
+ child_process
+ AWS / Huawei Cloud
+ Proxy runtime
+ DB / scripts
+ 报告与运行记录
```

目标不是：

```text
bin/x 2900 行
  -> commands/a.js 300 行
  -> commands/b.js 400 行
  -> commands/c.js 500 行
```

这种做法只移动代码，没有建立关注分离点。

目标是形成与 MCP 相同的入口原则：

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

最终应满足一句话：

> **入口只负责翻译，Application 只负责流程，Business 只负责规则，Capability/Logic 只负责确定性计算，Port 只描述外部需求，Adapter 只连接外部世界。**

---

## 2. 为什么现在处理 `bin/x`

MCP 合入主线后，仓库已经有了一套较清晰的新边界：

```text
src/adapters/mcp/
src/application/
src/business/
src/ports/
src/adapters/ledger/
```

如果继续让 CLI 在 `bin/x` 中直接组合业务、文件、Git、网络和云实现，就会形成两套架构：

```text
MCP -> Application -> Ports -> Adapters   # 新路径
CLI -> bin/x 巨型控制器 -> 各种具体实现    # 旧路径
```

长期会导致：

- 同一能力在 MCP 和 CLI 出现不同实现；
- 业务规则修改时需要同时找 Application 与 `bin/x`；
- 新增入口时继续复制编排；
- AI 难以判断逻辑究竟应该放在哪一层；
- `bin/x` 成为任何功能修改都可能触碰的高冲突文件。

因此，本阶段目标是让 CLI 逐步回到“外层 Adapter”的位置。

---

## 3. 当前问题盘点

### 3.1 集中式命令协议

当前 `bin/x` 统一维护：

- `printUsage()`；
- `parseOptions()`；
- 所有 command family；
- `main()` 中的命令路由；
- 顶层错误输出和 `process.exit(1)`。

结果是新增一个命令往往需要修改同一个中心文件。

### 3.2 CLI Handler 直接拥有基础设施

当前文件直接使用或动态加载：

- `node:fs/promises`；
- `node:child_process`；
- Git；
- AWS；
- Proxy runtime；
- DB / scripts；
- 数据账本路径。

这意味着 CLI 不只是“调用能力”，而是在决定能力如何执行。

### 3.3 CLI Handler 含流程和状态控制

例如 proxy / benchmark / daily 等命令包含：

- 循环与 deadline；
- runtime 生命周期；
- report 写入；
- failure / retry 控制；
- 任务状态投影；
- 数据提交；
- `process.exitCode` 决策。

其中一部分属于入口展示，一部分属于 Application，一部分属于 Infrastructure，目前没有稳定边界。

### 3.4 CLI 中存在业务语义泄漏风险

任何类似下面的判断都不应该由 CLI 拥有：

```text
数据是否达到质量门槛
任务是否允许继续
是否需要重试
使用哪一种业务策略
某种 market/profile 如何选择
某个阈值是否命中
```

CLI 只应该把用户显式参数转换为 Application Request。

### 3.5 `main()` 是单点路由热点

当前通过连续 `if` 判断分发所有命令。它把所有 command family 都耦合到一个文件中。

这不是主要业务风险，但会放大每次功能变化的修改面和冲突概率。

---

## 4. 强制设计原则

### RULE-CLI-01：`bin/x` 必须最终成为薄入口

最终职责仅允许：

```text
#!/usr/bin/env node
-> 调用 CLI entry
-> 将未处理异常映射为进程退出
```

目标形态示意：

```js
#!/usr/bin/env node

const { runCli } = require("../src/adapters/cli/entry");

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
```

不要求第一步立即达到此形态，但每一阶段必须朝这个方向单调收敛。

### RULE-CLI-02：CLI Command 只做协议翻译

Command Handler 允许：

- 解析 CLI 参数；
- CLI 特有的必填参数检查；
- 将字符串转换为 Application Request DTO；
- 调用一个 Application Use Case / facade；
- 选择 JSON / human presenter；
- 映射稳定错误到 stderr / exit code。

Command Handler 禁止：

- 直接读写业务数据文件；
- 直接执行 SQL；
- 直接请求行情 API；
- 直接决定业务 retry；
- 直接计算指标；
- 直接选择策略业务结果；
- 直接拼装 Git 数据提交规则；
- 直接包含固定投资/数据业务阈值。

### RULE-CLI-03：Application 不知道 CLI

`src/application/**` 不得 import：

```text
src/adapters/cli/**
process.argv
console
TTY
CLI help
```

Application 输入输出必须可由 MCP / HTTP / Actions 复用。

### RULE-CLI-04：业务与能力继续分离

具体业务策略放在 Business Policy / Application：

```text
DailyRefreshPolicy
RetryPolicy
DataCommitPolicy
...
```

通用能力继续保持场景无关：

```text
KlineReader
KlineValidator
ReportGenerator
GitRepository
ProcessRunner
...
```

不得为了迁移 CLI 新建：

```text
CliKlineCalculator
CliDailyPolicy
CliRetryLogic
```

### RULE-CLI-05：控制与逻辑分离

纯计算、选择、归一化只依赖内存输入输出。

业务流程的调用顺序属于 Application。

CLI 只拥有终端协议控制：

- argv；
- stdout/stderr；
- human/json 输出；
- exit code；
- help/version；
- 交互式进程生命周期（仅 CLI 专属场景）。

### RULE-CLI-06：Composition Root 可以知道具体实现

依赖注入的装配点允许依赖具体 Adapter：

```text
src/adapters/cli/composition_root.js
```

它的职责是 wiring，不允许承载业务判断。

不要为了“纯粹”让每一个小函数都引入接口；只有 Application 需要外部能力替换/测试时才定义 Port。

### RULE-CLI-07：禁止 Command 相互调用

禁止：

```text
DailyCommand -> KlineCommand -> GitCommand
```

允许：

```text
DailyCommand -> RunDailyUseCase
KlineCommand -> SyncKlineUseCase
GitCommand   -> CommitDataUseCase

RunDailyUseCase -> shared capabilities / ports
```

否则 CLI 命令层会重新变成隐藏 Application 层。

### RULE-CLI-08：保持 CLI 合同兼容

第一轮重构不得借机修改：

- command name；
- flag name；
- 默认值；
- stdout 核心字段；
- JSON shape；
- 正常退出码；
- 已知错误退出码；
- GitHub Actions 对 `bin/x` 的调用方式。

需要修改 CLI UX 的需求必须作为独立变更处理。

---

## 5. 最小目标结构

不引入完整 DDD 目录树，只增加 CLI 必需边界。

```text
bin/
  x

src/
  adapters/
    cli/
      entry.js
      router.js
      usage.js
      error_presenter.js
      composition_root.js
      commands/
        doctor.js
        simulator.js
        pool.js
        stocks.js
        codes.js
        kline.js
        daily.js
        run.js
        report.js
        db.js
        stats.js
        aws.js
        proxy.js
        benchmark.js
        git.js

    mcp/
      ...

  application/
    market/
    analytics/
    strategy/
    simulation/
    # 根据真实 use case 渐进增加：
    daily/
    jobs/
    reports/
    operations/

  business/
    ...

  ports/
    ...
```

这里的目录只是变化边界，不要求所有 command family 都创建同名 Application 目录。

例如：

```text
CLI command: x report daily
    -> GenerateDailyReportUseCase

CLI command: x git commit-data
    -> CommitRunDataUseCase

CLI command: x daily
    -> RunDailyPipelineUseCase
```

Application 应按业务用例命名，而不是按 CLI 命令机械镜像。

---

## 6. CLI 内部职责拆分

### 6.1 `entry.js`

职责：

```text
argv
-> router.resolve()
-> handler.execute()
-> presenter
-> exit code
```

不得知道股票业务。

### 6.2 `router.js`

只维护：

```text
(command, subcommand) -> handler
```

推荐声明式注册：

```js
[
  { path: ["doctor"], handler: doctorCommand },
  { path: ["kline", "sync"], handler: klineSyncCommand },
  { path: ["report", "daily"], handler: reportDailyCommand },
]
```

避免继续增长一个巨大 `if/else`。

### 6.3 `usage.js`

帮助文本属于 CLI 协议，可以按 command family 拆成定义，但不需要为 help 创建 Application 层。

### 6.4 `commands/*`

每个 command family 只负责：

```text
CLI argv
-> normalize CLI input
-> Application Request
-> Use Case
-> Presenter DTO
```

建议一个文件按 command family 聚合，而不是一开始就“一个 subcommand 一个文件”。

当某个 family 文件再次出现多个独立变化原因时再拆。

### 6.5 `composition_root.js`

CLI 唯一允许集中知道具体 Application / Adapter wiring 的地方。

后续若 MCP、HTTP、CLI 对同一 Application wiring 重复，再抽：

```text
src/bootstrap/
```

当前不要提前建立 bootstrap 大框架。

---

## 7. Application 边界判断标准

一个逻辑应从 CLI 下沉到 Application，当它回答以下任何问题：

```text
接下来应该执行什么？
失败后是否继续？
是否重试？
结果是否达到业务成功条件？
要组合哪些能力？
要写哪些运行记录？
哪一种业务策略应该生效？
```

一个逻辑应留在 CLI，当它只回答：

```text
用户传了什么 flag？
输出 JSON 还是 human text？
help 怎么展示？
错误打印到 stdout 还是 stderr？
进程应该返回哪个由 Application Error 映射出的 exit code？
```

---

## 8. Infrastructure / Port 判断标准

不要机械地给所有 `fs` 创建 Port。

### 必须通过 Port 的情况

如果 Application 需要它，并且它属于外部世界：

```text
GitRepository
RunRepository
KlineReader / Writer
SecurityMasterReader / Writer
ProcessRunner
CloudKlineExecutor
ProxyProvider
Clock（只有需要确定性时间测试时）
```

### 可以留在 CLI Adapter 的情况

纯入口技术细节：

```text
console.log
process.stderr
process.exitCode
process.argv
TTY 检测
help 文本
```

### 可以留在 Infrastructure Adapter 的情况

```text
fs
SQLite
Git CLI
AWS SDK
HTTP
child_process
```

关键标准不是“有没有 IO”，而是：**谁需要这个 IO，以及谁拥有其业务决策。**

---

## 9. 迁移策略：Strangler，而不是重写

### Phase 0：建立兼容性基线

先锁住当前 CLI 合同：

- `bin/x --help`；
- `bin/x doctor`；
- 关键 command 的参数错误；
- JSON 输出 shape；
- exit code；
- GitHub Actions 当前调用。

新增测试时优先测试“外部合同”，不要测试 `bin/x` 内部函数实现。

完成条件：

```text
重构前后，同一 CLI 输入得到兼容输出和退出码。
```

### Phase 1：抽出 CLI Shell

只迁移协议层：

```text
entry
router
usage
error presenter
option parsing
```

此阶段允许 command handler 暂时调用旧实现桥接，但桥接必须显式标记为 temporary。

目标：

```text
bin/x 只保留启动代码。
```

注意：如果只是把所有旧代码复制到 `legacy.js`，Phase 1 只能算过渡，不算架构完成。

### Phase 2：迁移低风险叶子命令

优先迁移业务耦合较低的 family：

```text
doctor
run (read-only list/show/failures)
report
db
stats
simulator
```

目的：验证：

```text
CLI Handler -> Application/Capability -> Adapter
```

模式是否稳定。

### Phase 3：迁移外部执行型命令

迁移：

```text
aws
proxy
benchmark
git
```

重点不是把实现搬到 `commands/`，而是把：

```text
业务决策 / 流程控制
```

与：

```text
AWS / Proxy / Git / process 具体执行
```

拆开。

### Phase 4：迁移 Kline family

迁移：

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

Kline 是多个入口未来高复用区域，应优先复用现有：

```text
src/kline/
src/application/market/
src/ports/market/
src/adapters/ledger/
```

不允许创建 CLI 专属 Kline 业务实现。

### Phase 5：最后迁移 `daily`

`daily` 是最高风险和最高价值的编排入口，应最后迁移。

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

这里的子步骤不要求全部变成类；先按真实稳定分离点抽 Use Case / Capability。

`DailyCommand` 不应该知道：

- 失败批次如何重试；
- progress 如何合并；
- 哪些质量问题允许 partial；
- strategy universe 如何选择；
- 数据提交 pathspec 如何生成。

---

## 10. 第一条垂直切片建议

第一项代码任务不要直接碰 `daily`。

建议先做：

```text
x report daily
```

理由：

- 业务范围窄；
- 已存在 `generateDailyReport` 能力；
- 能验证 CLI Handler 与共享 Application 的关系；
- 不需要先解决复杂 retry/cloud/proxy；
- 容易做前后输出兼容测试。

目标调用链：

```text
bin/x
 -> CLI Router
 -> ReportDailyCommand
 -> GenerateDailyReportUseCase
 -> Report capability / repositories
 -> result
 -> CLI presenter
```

验收必须证明：

1. `report daily` CLI 合同不变；
2. Application 测试不启动 CLI；
3. CLI command 测试使用 Fake Use Case；
4. 报告生成逻辑不依赖 argv / console；
5. MCP/其他入口未来需要生成报告时可以直接复用 Use Case。

---

## 11. Command Result 与错误边界

不要求所有 Use Case 返回统一超级 DTO。

CLI 层只需要稳定区分：

```text
成功结果
业务/输入错误
外部能力不可用
内部错误
```

Application Error 使用稳定 `code`，例如：

```text
invalid_arguments
data_not_found
data_incomplete
capability_unavailable
conflict
```

CLI Adapter 映射为：

```text
message
stderr/stdout
exit code
```

禁止将：

```text
ENOENT
SQLITE_BUSY
AWS SDK stack
spawn error stack
```

直接作为稳定 CLI 契约。

同时不要为了统一而破坏现有 CLI 文案；兼容优先，错误模型可以渐进收敛。

---

## 12. 输出与 Presenter

JSON 与 human 输出是 CLI concern。

推荐：

```text
Application Result
   |\
   | +-> JsonPresenter
   |
   +----> HumanPresenter
```

但不要一开始为所有 command 建复杂 presenter class。

简单命令可以是纯函数：

```js
formatHuman(result)
```

只有输出复杂度明显增长时才继续拆。

---

## 13. Composition Root 约束

允许：

```text
CLI composition root
 -> new Ledger...
 -> new Aws...
 -> new UseCase(...)
 -> new Command(...)
```

禁止：

```text
if (drawdown > 0.08) ...
if (quality < threshold) ...
if (strategy === ...) ...
```

Composition Root 只决定“接哪一个实现”，不能决定业务结果。

配置决定选择，业务代码决定规则。

---

## 14. 架构 Fitness Rules

建议随着迁移进入测试/CI。

### 自动检查

```text
FIT-CLI-01 bin/x 只能依赖 src/adapters/cli/entry。
FIT-CLI-02 src/application/** 不得依赖 src/adapters/cli/**。
FIT-CLI-03 src/business/** 不得依赖 CLI / console / process.argv。
FIT-CLI-04 CLI command handler 不得直接依赖 data/ 路径。
FIT-CLI-05 CLI command handler 不得直接依赖 SQLite/AWS/Proxy/Git 实现。
FIT-CLI-06 command handler 之间不得相互 import。
FIT-CLI-07 同一确定性能力不得在 CLI 目录复制实现。
```

### 代码评审检查

```text
FIT-CLI-08 固定业务阈值不得进入 CLI handler。
FIT-CLI-09 retry/quality/strategy 决策不得进入 presenter/router。
FIT-CLI-10 新增 CLI command 前先判断是否已有 Application Use Case。
```

不要一开始引入重量级架构框架；可以先用 Node 测试扫描 import/require。

---

## 15. 测试策略

### 15.1 CLI Contract Test

从用户视角测试：

```text
argv
stdout
stderr
exit code
```

重点覆盖常用命令，不追求所有组合穷举。

### 15.2 Command Handler Test

Fake Use Case：

```text
输入转换是否正确
Use Case 是否只调用一次
Presenter 是否正确
错误是否映射正确
```

不得访问真实网络/文件系统。

### 15.3 Application Test

Fake Port 验证：

```text
业务流程顺序
失败分类
重试策略
时间边界
质量门禁
```

不启动 CLI。

### 15.4 Adapter Test

针对真实：

```text
Git
Ledger
SQLite
AWS
Proxy
Process
```

单独做集成测试。

---

## 16. 复杂度控制规则

为了避免从 God CLI 走向“层级爆炸”，本次重构增加以下限制：

### 16.1 不按名词机械建层

禁止为了架构图创建空壳：

```text
Controller -> Service -> Manager -> Facade -> UseCase -> Handler
```

一次调用如果没有独立变化原因，不需要经过所有层。

### 16.2 一个稳定分离点才值得一个抽象

满足任一条件再抽：

- 有两个入口需要复用；
- 需要 Fake 实现进行独立测试；
- 外部实现可能替换；
- 有独立业务规则变化；
- 当前文件明显混合两种变化原因。

### 16.3 不为了减少行数拆文件

一个 300 行、职责单一的 Application Use Case 可能比 10 个相互跳转的 30 行类更容易维护。

### 16.4 每一阶段必须删除旧路径

迁移完成一个 command family 后：

```text
新路径成为唯一实现
旧 bin/x 实现删除
```

禁止长期同时保留 legacy/new 两套实现。

---

## 17. 与 MCP 的统一原则

MCP 已经证明下面的边界可行：

```text
MCP Tool
 -> Application Use Case
 -> Port
 -> Adapter
```

CLI 重构不是建立新的 CLI 架构，而是让 CLI 加入同一个体系：

```text
                 +-> MCP Tool
                 |
Application <----+-> CLI Command
                 |
                 +-> HTTP Handler
                 |
                 +-> Actions Entrypoint
```

因此未来新增能力的顺序应优先是：

```text
Business Rule / Capability
 -> Application Use Case
 -> 需要哪些 Adapter
 -> 最后暴露 CLI/MCP/HTTP
```

而不是先在 `bin/x` 写功能，再考虑复用。

---

## 18. 不在本阶段做的事情

本阶段明确不做：

- 修改 CLI UX；
- 更换 CLI framework；
- 引入 Commander/Yargs 仅为了减少 parseOptions；
- 全仓库目录大搬家；
- 重写 Kline/Strategy/Simulator 算法；
- 为每一个 fs/process 调用创建 Port；
- 同时清理所有历史脚本；
- 顺手重构 MCP；
- 顺手升级技术栈。

这些都会扩大变更面，削弱本阶段“建立 CLI/Application 边界”的主目标。

---

## 19. 分阶段验收标准

### 第一阶段完成

```text
[ ] 有 CLI contract baseline tests
[ ] bin/x 只负责启动或明显收敛为薄入口
[ ] router/help/error 从业务实现中分离
[ ] 至少一个 command family 完成垂直迁移
[ ] 新 command handler 可用 Fake Use Case 测试
```

### 中期完成

```text
[ ] 低风险 command family 已迁移
[ ] cloud/proxy/git 具体实现不再出现在 CLI handler
[ ] Kline CLI 复用共享 Application/Port
[ ] 架构 import rules 进入 CI
```

### 最终完成

```text
[ ] bin/x 为薄入口
[ ] daily 业务流程不在 CLI
[ ] CLI command 之间无调用链
[ ] CLI 不拥有数据/策略/重试业务规则
[ ] CLI/MCP 对共享能力只有一个权威实现
[ ] 现有 CLI 合同保持兼容
[ ] legacy CLI 实现全部删除
```

---

## 20. ADR 摘要

### ADR-CLI-001：CLI 是 Adapter

**决定**：CLI 与 MCP 一样是外层 Adapter。

**原因**：入口协议变化不应该改变业务实现。

### ADR-CLI-002：采用渐进式 Strangler Migration

**决定**：按 command family / vertical slice 逐步迁移，不做一次性重写。

**原因**：`bin/x` 当前承载大量生产工作流，一次性改造回归风险过高。

### ADR-CLI-003：不机械创建 Port

**决定**：只有 Application 需要隔离外部能力时创建 Port。

**原因**：避免关注分离演变成层级和接口爆炸。

### ADR-CLI-004：保持现有 CLI 合同

**决定**：架构重构与 CLI UX 变更分开。

**原因**：降低 GitHub Actions、人工脚本和既有使用方式的回归风险。

### ADR-CLI-005：`daily` 最后迁移

**决定**：先用低风险垂直切片验证架构，再迁移最复杂的 daily orchestration。

**原因**：先建立稳定模式，再处理最大风险区。

### ADR-CLI-006：禁止命令间调用

**决定**：Command 只能调用共享 Application，不得通过调用其他 Command 复用逻辑。

**原因**：防止 CLI 层重新形成隐藏业务编排层。

---

## 21. 推荐下一项代码任务

设计评审通过后，第一项实现任务：

```text
Phase 0 + 第一条垂直切片
```

具体顺序：

1. 为 `report daily` 建立现有 CLI contract test；
2. 创建最小 `src/adapters/cli/entry.js` / `router.js` 基础；
3. 抽 `ReportDailyCommand`；
4. 将报告流程通过 Application Use Case 暴露；
5. Command 使用 Fake Use Case 做单测；
6. 保持 `bin/x report daily --date ...` 行为不变；
7. 删除 `bin/x` 中对应旧实现；
8. 运行 `npm run check && npm test && bin/x doctor && bin/x --help`；
9. 验证 GitHub Actions 不受影响。

这条切片完成后再评审抽象是否足够，而不是一次性生成所有 command handler。

---

## 22. 最终判断标准

本次重构是否成功，不看 `bin/x` 从多少行减少到多少行，而看以下问题能否回答“是”：

```text
新增 MCP/HTTP 入口时，是否不需要复制 CLI 业务逻辑？
修改业务规则时，是否不需要进入 CLI 目录？
修改 CLI 参数时，是否不需要修改业务逻辑？
替换 Git/DB/Cloud 实现时，是否不需要修改 Command Handler？
Application 是否可以完全脱离 CLI 独立测试？
同一能力是否只有一个权威实现？
```

如果答案都是“是”，关注点才真正分离。
