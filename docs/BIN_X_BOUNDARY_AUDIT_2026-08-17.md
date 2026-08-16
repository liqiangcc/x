# `bin/x` 边界审计（2026-08-17）

> 基线：`master` after PR #79 (`proxy pool warmup` boundary migration)
> 目标：基于实际变化原因审计 `bin/x` 剩余职责，不按文件大小机械拆分。

## 1. 结论

`bin/x` 已经从“所有命令都直接实现”的入口，演进到“部分 family 只做路由、部分 legacy flow 仍内联”的过渡状态。

本次审计确认：

1. `proxy pool` 的 `verify / select / status / refresh-github / up / down / diagnose / probe / benchmark / warmup` 已经全部委托到独立 CLI Adapter；`commandProxyPool()` 只剩路由。
2. `parseDurationMs()` 与 `parsePositiveOption()` 是 proxy-pool 迁移后遗留的确定死代码：在 `bin/x` 中只有定义，没有调用方。
3. 当前最适合继续迁移的最小真实分离点是 `proxy list / rotate / check`。它们仍在 `commandProxy()` 中直接解析参数并调用 `src/proxy/clash`，但已有稳定 capability，不需要为了层次对称额外创建 Application/Port。
4. 当前价值最高但风险最大的分离点是 `commandDaily()`。它同时拥有协议解析、运行编排、策略选择、router probe、universe、freshness、job progress、kline sync、quality、artifact、exit-code 等多种变化原因，不能用“把整个函数搬到另一个文件”的方式处理。

## 2. 已经形成边界的区域

### 2.1 已委托 command family

当前入口已经通过独立 CLI adapter / command object 委托：

- `doctor`
- `simulator`
- `run`
- `db`
- `stats`
- `benchmark`
- `git`
- AWS `probe-router / status / sync-github-secrets / latency`
- Proxy Pool 全部子命令

其中 Proxy Pool 当前结构已经达到：

```text
bin/x
  -> commandProxyPool() router
      -> dedicated CLI adapters
          -> Application / capability / infrastructure boundaries as needed
```

因此后续不应继续围绕 Proxy Pool 做“为了拆而拆”的框架化工作。

## 3. 确定死代码

### `parseDurationMs()`

历史用途：`proxy pool probe / warmup` 的 duration CLI 解析。

当前状态：duration 解析已经分别进入对应 CLI Adapter，`bin/x` 中只剩定义。

结论：删除。

### `parsePositiveOption()`

历史用途：`proxy pool diagnose / probe / benchmark / warmup` 的正整数 CLI 校验。

当前状态：这些协议校验已经进入各自 CLI Adapter，`bin/x` 中只剩定义。

结论：删除。

注意：`parsePositiveIntegerOption()` 与 `parseNonNegativeIntegerOption()` 仍被 daily / kline flow 使用，不属于死代码。

## 4. `bin/x` 当前剩余职责

### A. 合理保留在 CLI Entry 的职责

- `printUsage()`
- 顶层 `main()` 路由
- 顶层错误输出 / process exit
- 过渡期通用 CLI 参数解析 `parseOptions()`

这些属于 CLI protocol / entry concern。

### B. 仍内联但适合小切片迁移

#### B1. `proxy list / rotate / check` — 下一优先级

当前：

```text
commandProxy()
  -> parseOptions()
  -> require(src/proxy/clash)
  -> listProxies / rotateProxy / checkEastmoneyAccess
  -> printJson()
```

分离点清晰：这是 CLI protocol 到既有 capability 的映射。

建议下一切片：

```text
bin/x
  -> Proxy Clash CLI Adapter
      -> existing src/proxy/clash capability
```

原则：

- CLI Adapter 负责 `--config / --group / --proxy` 与 JSON presentation；
- 保持 `pool` family 继续由 `commandProxyPool` 路由；
- 不新增 Application Use Case；
- 不新增 Port；
- 不改 Clash capability；
- 不引入 generic proxy command framework。

#### B2. `report daily`

当前只是 CLI 参数验证 + `generateDailyReport()` + presentation，适合独立 CLI Adapter；是否需要 Application 层应根据真实 orchestration 判断，不为对称强加。

#### B3. `pool pull / stocks fetch / codes build`

主要还是 child-process protocol wrapper，可以逐个迁移；重点是把 argv 翻译与 process infrastructure 分开，而不是把三个命令合成“万能 data command”。

### C. 中等复杂度：Kline command family

仍内联：

- fetch
- sync
- aggregate-yearly
- retry
- retry-queue
- sync-status / unlock
- validate
- freshness

这里已经出现共享行为：

- `runNode*`
- `appendKlineSyncOptions()`
- retry input extraction
- sync lock
- freshness report / repair command

应按用例逐个识别边界，不直接把整个 `commandKline*` 区域搬进一个 `kline.js` 大文件。

## 5. 最高价值 / 最高风险：`commandDaily()`

`commandDaily()` 不是普通 CLI command，它已经实际承担 Application Pipeline：

```text
resolve CLI request
-> router probe
-> pool snapshot
-> market universe
-> strategy universe
-> engine/policy selection
-> freshness context
-> stale scan
-> job progress
-> invalid-kline cleanup
-> kline sync
-> yearly aggregation
-> quality validation
-> progress update
-> run/failure/quality artifacts
-> optional commit
-> exit policy
```

这里同时混合：

- CLI protocol
- Application orchestration
- Business policy
- filesystem
- child process
- reporting
- job state
- external capability selection

因此禁止下一步直接执行：

```text
commandDaily() -> src/application/run_daily_pipeline.js
```

如果只是整体搬运，仍然是一个巨型多职责函数。

正确路线应是从已存在的真实分离点逐个抽出，例如：

1. Daily request parsing / CLI presentation；
2. router-region resolution capability；
3. universe preparation；
4. freshness preparation / stale scan；
5. job progress repository / orchestration；
6. kline sync execution boundary；
7. run artifacts / quality persistence；
8. 最后才形成薄的 `RunDailyPipelineUseCase`。

## 6. 本轮动作

本 PR 只做两件事：

1. 删除审计确认的 `parseDurationMs()` / `parsePositiveOption()` 死代码；
2. 固化这份审计，明确下一真实分离点。

本 PR **不**迁移 `proxy list / rotate / check`，因为“审计/死代码清理”和“行为边界迁移”应分成不同 review 单元。

## 7. 下一切片

建议下一 PR：`proxy list / rotate / check` CLI boundary。

预期结构：

```text
bin/x
  -> commandProxy router
      -> commandProxyPool
      -> Proxy Clash CLI Adapter
           -> existing Clash capability
```

验收条件：

- list/rotate/check CLI 合同不变；
- protocol validation 在 capability resolution 前完成；
- `bin/x` 不再直接 require `src/proxy/clash`；
- `bin/x` 不再拥有 list/rotate/check presentation；
- Proxy Pool 路由不受影响；
- 不新增无真实需求的 Application/Port。
