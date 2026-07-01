# AWS Forwarder / Probe 实施计划

> 日期：2026-07-01  
> 目标：在不引入 API Gateway、CloudFront、Global Accelerator、DynamoDB、S3、SQS、Step Functions、Provisioned Concurrency 等额外服务的前提下，新增一个低成本、受控的 `aws-router` engine，用 Router Lambda Function URL 统一入口、Region probe、延迟指标和 fallback。
> 面向执行者：Codex / AI 开发代理。

## 1. 背景和目标

当前 `x` 已经具备 `--engine aws`，通过 AWS SDK `InvokeFunction` 调用多 Region Lambda 获取东方财富 Kline 数据。现有 `aws` engine 已经包含 Region 轮询和 fallback；`fetch/query_pool_klines.js` 也会按股票索引轮转起始 Region。

本方案不是替换现有 `aws` engine，而是新增一个独立的 `aws-router` engine，用于：

```text
GitHub Actions 不再需要 AWS 长期访问密钥即可抓取 kline
统一收集 router/target/eastmoney duration 指标
集中管理和测试 AWS Region 出口池
通过 Router 暴露唯一公网入口，避免 Target Lambda 公网暴露
保留 aws/local/auto 现有行为，便于 A/B 测试和回滚
```

v1 只做单股请求和 Region probe，不做复杂智能调度。

## 2. 硬性约束

### 2.1 必须遵守

```text
只使用 Lambda 和 Router Lambda Function URL
Target Lambda 不创建 Function URL，不公网暴露
不使用 API Gateway
不使用 CloudFront
不使用 Global Accelerator
不使用 DynamoDB
不使用 S3 作为状态存储
不使用 SQS / Step Functions
不使用 Provisioned Concurrency
不提交任何 AWS key / token / Function URL
不提交 zip 包 / .env / credentials
```

### 2.2 安全边界

不能做开放代理。Router 不允许接收任意 URL，例如：

```json
{
  "url": "https://任意网站.com"
}
```

Router 只能调用 `TARGETS_JSON` 白名单中的 Target Lambda：

```json
{
  "ap-northeast-1": { "function_name": "kline-target" },
  "ap-southeast-1": { "function_name": "kline-target" },
  "us-west-2": { "function_name": "kline-target" }
}
```

公网入口只有 Router Lambda Function URL。GitHub Actions / 本机请求 Router 时必须带：

```text
x-router-token: <ROUTER_TOKEN>
```

Target Lambda 只通过 Router 的 IAM 权限被 `InvokeFunction` 调用，不校验外部 HTTP token。

### 2.3 非目标

v1 不做：

```text
复杂智能路由
持久化 Region 健康度
Dashboard
缓存
批量请求 API
Web UI
成本统计系统
自动切换默认 engine
修改 auto engine 语义
```

## 3. 目标架构

```text
+----------------------+
| GitHub Actions/bin/x |
+----------------------+
           |
           | HTTPS POST /kline or /probe
           | x-router-token
           v
+-----------------------------+
| Router Lambda Function URL  |
| public, token protected     |
+-----------------------------+
           |
           | AWS SDK InvokeFunction
           | target region whitelist
           v
+-----------------------------+
| Target Lambda               |
| no Function URL             |
| ap-northeast-1 / ...        |
+-----------------------------+
           |
           v
+-----------------------------+
| Eastmoney Kline API         |
+-----------------------------+
```

Router Lambda 部署一个。Target Lambda 按 Region 部署多个同名函数。

推荐第一批 Target Regions：

```text
ap-northeast-1
ap-northeast-2
ap-southeast-1
us-west-2
```

第一版先部署 3 到 6 个常用 Region，不要一口气部署全部 17 个 Region。当前默认收敛为 `ap-northeast-1,ap-northeast-2,ap-southeast-1,us-west-2`；`us-east-1` 暂不作为默认 Target，除非后续 benchmark 证明稳定。

## 4. AWS 资源设计

### 4.1 Router Lambda

推荐名称：

```text
kline-router
```

推荐 Region：

```text
ap-northeast-1
```

Router 使用 Lambda Function URL：

```text
AuthType: NONE
```

函数内部必须校验 `x-router-token`。

Router 环境变量：

```text
ROUTER_TOKEN
TARGETS_JSON
ROUTER_MAX_FALLBACKS
ROUTER_TARGET_TIMEOUT_MS
```

`TARGETS_JSON` 示例：

```json
{
  "ap-northeast-1": { "function_name": "kline-target" },
  "ap-southeast-1": { "function_name": "kline-target" },
  "us-west-2": { "function_name": "kline-target" }
}
```

### 4.2 Target Lambda

推荐名称：

```text
kline-target
```

Target 不创建 Function URL。Target 只接收 Lambda invoke event。

Target IAM 只需要基本执行权限：

```text
AWSLambdaBasicExecutionRole
```

### 4.3 IAM

Router execution role 需要：

```text
AWSLambdaBasicExecutionRole
lambda:InvokeFunction
```

`lambda:InvokeFunction` 必须最小化到部署脚本输出的 Target Lambda ARN，例如：

```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunction",
  "Resource": [
    "arn:aws:lambda:ap-northeast-1:<account-id>:function:kline-target",
    "arn:aws:lambda:ap-southeast-1:<account-id>:function:kline-target"
  ]
}
```

不要把部署权限写进函数 role。创建和更新 IAM role / policy / function 的权限只属于本机或部署环境。

## 5. Target Lambda 设计

新增目录：

```text
lambda/target-kline/
  index.mjs
  package.json
```

Target Lambda 接收 Router 通过 `InvokeFunction` 传入的 JSON：

```json
{
  "secid": "0.000001",
  "klt": 101,
  "lmt": 100000,
  "end": "20991231"
}
```

参数校验：

```text
secid 格式：0.xxxxxx 或 1.xxxxxx
klt 只允许 101 / 106
lmt 必须是正整数，默认 100000
end 必须是 YYYYMMDD，默认 20991231
```

Target 要么复用仓库现有 `src/sources/eastmoney/client.js` 的 kline 请求逻辑，要么复制最小实现；无论哪种方式，输出必须兼容现有 `fetch/fetch_kline.js` 的 `normalizeKlineData()` 输入。

成功返回：

```json
{
  "ok": true,
  "source_engine": "aws-router-target",
  "source_region": "ap-northeast-1",
  "target_duration_ms": 420,
  "eastmoney_duration_ms": 350,
  "data": {
    "code": "000001",
    "market": 0,
    "klines": []
  }
}
```

失败返回：

```json
{
  "ok": false,
  "error": "Eastmoney request timeout",
  "source_engine": "aws-router-target",
  "source_region": "ap-northeast-1",
  "target_duration_ms": 3000,
  "error_class": "timeout"
}
```

Target Lambda timeout 建议：

```text
5 到 8 秒
```

Target 内部请求东方财富 timeout 建议：

```text
3 到 5 秒
```

## 6. Router Lambda 设计

新增目录：

```text
lambda/router/
  index.mjs
  package.json
```

### 6.1 通用 HTTP 规则

Router Function URL 只支持：

```text
GET /health
POST /probe
POST /kline
```

除 `/health` 外，其余请求都必须带：

```text
x-router-token: <ROUTER_TOKEN>
content-type: application/json
```

错误响应统一为：

```json
{
  "ok": false,
  "error": "message",
  "error_class": "unauthorized|invalid_request|invalid_region|timeout|upstream|not_found"
}
```

推荐 HTTP status：

```text
401 token 缺失或错误
404 不支持的 path
405 不支持的 method
400 请求参数错误或 region 不在白名单
502 所有 target 失败
504 target timeout
200 成功
```

禁止在日志或响应中打印 `ROUTER_TOKEN`。

### 6.2 `/health`

请求：

```text
GET /health
```

返回：

```json
{
  "ok": true,
  "service": "kline-router",
  "region": "ap-northeast-1",
  "time": "2026-07-01T01:00:00Z"
}
```

`/health` 不访问 Target Lambda。

### 6.3 `/probe`

用于测试一个或多个 Region 的延迟。

请求：

```json
{
  "region": "all",
  "secid": "1.600519",
  "klt": 101,
  "lmt": 1,
  "end": "20991231"
}
```

`region` 支持：

```text
all
白名单中的单个 region
```

返回：

```json
{
  "ok": true,
  "source_engine": "aws-router-probe",
  "results": [
    {
      "region": "ap-northeast-1",
      "ok": true,
      "total_duration_ms": 620,
      "target_duration_ms": 500,
      "eastmoney_duration_ms": 420
    },
    {
      "region": "us-west-2",
      "ok": false,
      "total_duration_ms": 3000,
      "error": "timeout",
      "error_class": "timeout"
    }
  ]
}
```

### 6.4 `/kline`

请求：

```json
{
  "region": "auto",
  "secid": "0.000001",
  "klt": 101,
  "lmt": 100000,
  "end": "20991231"
}
```

`region` 支持：

```text
auto
白名单中的单个 region
```

返回：

```json
{
  "ok": true,
  "source_engine": "aws-router",
  "source_region": "ap-southeast-1",
  "router_duration_ms": 15,
  "target_duration_ms": 820,
  "eastmoney_duration_ms": 760,
  "total_duration_ms": 850,
  "fallback_count": 1,
  "attempted_regions": ["ap-northeast-1", "ap-southeast-1"],
  "data": {
    "code": "000001",
    "market": 0,
    "klines": []
  }
}
```

Region 策略：

```text
如果 region 是具体值，只请求该 region
如果 region=auto，按 TARGETS_JSON 的 key 顺序尝试
单 region 超时或返回 ok=false 后尝试下一个
最多尝试 ROUTER_MAX_FALLBACKS 个 region，默认 4
所有 region 失败返回 502，并包含 attempted_regions
```

Router 调 Target 使用 AWS SDK `InvokeFunction`。每个 Target invoke 必须有 `ROUTER_TARGET_TIMEOUT_MS` 超时控制，默认 18000ms。Target 默认访问 `http://push2his.eastmoney.com/api/qt/stock/kline/get`，`EASTMONEY_TIMEOUT_MS` 默认 5000ms，`EASTMONEY_RETRIES` 默认 3。`/probe region=all` 并行探测所有白名单 Region，避免超过 Router Lambda timeout。

## 7. 部署脚本设计

新增：

```text
scripts/deploy-aws-router.sh
```

示例：

```bash
scripts/deploy-aws-router.sh \
  --router-region ap-northeast-1 \
  --target-regions ap-northeast-1,ap-northeast-2,ap-southeast-1,us-west-2 \
  --target-name kline-target \
  --router-name kline-router \
  --memory 128 \
  --router-timeout 120 \
  --target-timeout 20
```

职责：

```text
检查 aws CLI 是否存在
检查当前 AWS identity 和 account id
打包 target lambda 到临时目录
打包 router lambda 到临时目录
打包 Router 运行所需依赖，包括 @aws-sdk/client-lambda
创建或更新 target execution role
创建或更新 router execution role
创建或更新每个 target lambda
创建或更新 router lambda
创建或更新 router Function URL
设置 Router 环境变量
输出 Router URL、Target ARNs、GitHub Secret 配置命令、本地测试命令
```

重要要求：

```text
使用 Node.js 22 runtime
Router package.json 必须声明 @aws-sdk/client-lambda，部署包不能假设 runtime 内置该依赖
zip 包只能写入临时目录，不提交到仓库
不要把 token 写入仓库
不要把 Function URL 写入仓库
不要自动改 config/kline.json 写入真实 URL
脚本需要支持重复执行
默认复用已有 ROUTER_TOKEN
只有显式 --rotate-router-token 才生成新 token
部署失败要有清晰错误信息
更新函数后使用 aws lambda wait function-updated
```

部署输出示例：

```text
Router URL:
  https://xxx.lambda-url.ap-northeast-1.on.aws

Target ARNs:
  ap-northeast-1=arn:aws:lambda:ap-northeast-1:123456789012:function:kline-target
  ap-southeast-1=arn:aws:lambda:ap-southeast-1:123456789012:function:kline-target

Configure GitHub secrets:
  gh secret set AWS_ROUTER_URL
  gh secret set AWS_ROUTER_TOKEN

Local test:
  AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x kline fetch 000001 --period daily --engine aws-router
```

## 8. CLI 集成计划

### 8.1 `fetch/fetch_kline.js`

修改：

```text
VALID_ENGINES 新增 aws-router
usage 支持 --engine auto|local|aws|aws-router
config/kline.json 支持 aws_router_url_env / aws_router_token_env 示例字段
环境变量支持 AWS_ROUTER_URL / AWS_ROUTER_TOKEN
新增 fetchAwsRouterKline()
resolveKline 支持 engine=aws-router
auto engine 保持现有 aws -> local fallback，不改为 aws-router
```

`fetchAwsRouterKline()` 行为：

```text
POST ${AWS_ROUTER_URL}/kline
Header: x-router-token
Body: { region: "auto", secid, klt, lmt, end }
解析 Router 返回
normalize 为现有 kline 结构
source_engine = aws-router
source_region = Router 返回的 source_region
保留 router_duration_ms / target_duration_ms / eastmoney_duration_ms / total_duration_ms / fallback_count / attempted_regions
```

如果缺少 `AWS_ROUTER_URL` 或 `AWS_ROUTER_TOKEN`，`--engine aws-router` 必须直接报错，不 fallback 到 `local`。

### 8.2 `fetch/query_pool_klines.js`

修改：

```text
VALID_ENGINES 新增 aws-router
summary.engine_counts 支持 aws-router
summary.region_counts 记录 Router 返回的 source_region
summary.files[code] 记录 duration metrics 和 fallback_count
summary 增加 duration 统计字段
aws_success_zero 逻辑不要误伤 aws-router
```

建议新增字段：

```json
{
  "duration_ms_by_code": {},
  "avg_duration_ms": 0,
  "p50_duration_ms": 0,
  "p95_duration_ms": 0
}
```

批量流程当前通过子进程调用 `fetch/fetch_kline.js`，因此 duration metrics 必须先由单股脚本输出，再由 `processCode()` 写入 `summary.files[code]` 和聚合字段。

### 8.3 `bin/x`

修改 help：

```text
--engine auto|local|aws|aws-router
```

新增命令：

```bash
bin/x aws probe-router --secid 1.600519 --period daily
```

行为：

```text
读取 AWS_ROUTER_URL / AWS_ROUTER_TOKEN
POST ${AWS_ROUTER_URL}/probe
输出 Router /probe 的 JSON 结果
不要求 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

### 8.4 `config/kline.json`

不要写真实 URL 或 token。

可以增加示例字段：

```json
{
  "aws_router_url_env": "AWS_ROUTER_URL",
  "aws_router_token_env": "AWS_ROUTER_TOKEN"
}
```

真实 URL 和 token 通过环境变量或 GitHub Secrets 提供。

## 9. GitHub Actions 集成

需要修改：

```text
.github/workflows/daily-data-commit.yml
scripts/github-daily-workflow.js
tests/github-daily-workflow.test.js
```

workflow dispatch engine options 增加：

```text
aws-router
```

`Run daily data workflow` step env 增加：

```yaml
AWS_ROUTER_URL: ${{ secrets.AWS_ROUTER_URL }}
AWS_ROUTER_TOKEN: ${{ secrets.AWS_ROUTER_TOKEN }}
```

AWS credentials step 条件必须保持：

```text
engine=aws 或 engine=auto 时配置 AWS credentials
默认 engine=aws-router 时不配置 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

`scripts/github-daily-workflow.js` 要求：

```text
buildDailyArgs 支持 engine=aws-router
chain dispatch 保留 engine=aws-router
step summary 不再只硬编码 aws_successes；应输出 engine_counts/region_counts/duration stats
默认 engine 已切换为 aws-router；aws/auto 作为手动回退
```

## 10. 测试计划

新增或修改测试：

```text
tests/aws-router-target.test.js
tests/aws-router-lambda.test.js
tests/aws-router-fetch-kline.test.js
tests/query-pool-klines.test.js
tests/github-daily-workflow.test.js
```

必须覆盖：

```text
Target 参数校验
Target 成功/失败输出格式
Router token 校验
Router 只允许 /health /probe /kline
Router 拒绝任意 url 字段
Router 只允许白名单 region
Router 使用 SDK invoke 白名单 Target
Router region=auto fallback
Router /probe 输出格式
fetch_kline.js 支持 aws-router
fetch_kline.js 缺少 AWS_ROUTER_URL/TOKEN 时失败
query_pool_klines.js 支持 aws-router
query_pool_klines.js 聚合 duration metrics
workflow engine options 包含 aws-router
workflow engine=aws-router 时不配置 AWS credentials
```

本地验收命令：

```bash
npm run check
npm test
bin/x doctor
```

部署后验收需要真实 AWS 资源和 GitHub Secrets：

```bash
AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' \
  bin/x aws probe-router --secid 1.600519 --period daily

AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' \
  bin/x kline fetch 000001 --period daily --engine aws-router

AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' \
  bin/x kline sync data/universe/20260630 --period daily --engine aws-router --limit 10 --concurrency 4
```

## 11. A/B 测试计划

部署完成后，不要直接全量切换。

先跑：

```bash
bin/x kline sync data/universe/20260630 --period daily --engine aws --limit 50 --concurrency 4

AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' \
  bin/x kline sync data/universe/20260630 --period daily --engine aws-router --limit 50 --concurrency 4
```

对比：

```text
success_rate
avg_duration_ms
p50_duration_ms
p95_duration_ms
failure_reason_counts
region_counts
fallback_count
```

GitHub Action 默认 engine 已调整为 `aws-router`。`auto` 保持现有 `aws -> local` 行为，不自动替换为 `aws-router`。

## 12. 费用控制

为了适配 AWS 免费账号：

```text
Lambda memory 先用 128MB
Router timeout 8-12 秒
Target timeout 5-8 秒
不启用 Provisioned Concurrency
不使用 API Gateway / CloudFront / Global Accelerator
不使用 DynamoDB / S3 / SQS / Step Functions
外层 concurrency 从 4 开始
limit=50 做测试，再逐步放大
```

如果出现账单风险，立即把 workflow 手动选择的 engine 改回 `aws`。

## 13. 回滚方式

代码回滚：

```text
aws-router 是新增 engine，不影响现有 aws/local/auto
如果 aws-router 出问题，GitHub Action engine 改回 aws
保持 auto engine 不变
```

AWS 资源回滚：

```bash
aws lambda delete-function --function-name kline-router --region ap-northeast-1
aws lambda delete-function --function-name kline-target --region ap-northeast-1
```

Target Lambda 需要按部署脚本输出的全部 Region 逐个删除。实际删除命令以部署脚本输出的函数名和 Region 为准。

## 14. Codex 执行提示词

下面内容可以直接交给 Codex。

```text
你正在维护 liqiangcc/x 仓库。请实现 docs/AWS_FORWARDER_PROBE_PLAN.md 中定义的 AWS Forwarder / Probe 方案。

目标：
新增低成本 aws-router engine。GitHub Actions / bin/x 只通过 Router Lambda Function URL 访问 AWS；Router 校验 x-router-token 后使用 AWS SDK InvokeFunction 调用白名单 Target Lambda。Target Lambda 不创建 Function URL，不公网暴露。

硬性约束：
1. 不提交任何真实 AWS key、token、Function URL。
2. 不提交 .env、credentials、zip 包。
3. 不使用 API Gateway、CloudFront、Global Accelerator、DynamoDB、S3、SQS、Step Functions、Provisioned Concurrency。
4. Router 不能做开放代理，不能接受任意 URL。
5. Router 只能调用 TARGETS_JSON 白名单里的 Target Lambda。
6. 第一版不做缓存、不做持久化健康状态、不做复杂智能路由。
7. aws-router 是新增 engine，不能破坏现有 aws/local/auto 行为。
8. auto engine 继续保持现有 aws -> local fallback，不改为 aws-router。

需要完成：
1. 新增 lambda/target-kline/index.mjs 和 package.json。
2. 新增 lambda/router/index.mjs 和 package.json。
3. 新增 scripts/deploy-aws-router.sh。
4. 修改 fetch/fetch_kline.js，支持 --engine aws-router。
5. 修改 fetch/query_pool_klines.js，允许 engine=aws-router，并记录 duration/region/fallback 指标。
6. 修改 bin/x，help 中加入 aws-router，并新增 bin/x aws probe-router。
7. 修改 .github/workflows/daily-data-commit.yml，engine options 加 aws-router，并传入 AWS_ROUTER_URL/AWS_ROUTER_TOKEN secrets。
8. 修改 scripts/github-daily-workflow.js，支持 aws-router workflow 参数、summary 和 chained dispatch。
9. 更新 README，说明部署、GitHub Secrets、A/B 测试命令和回滚方式。
10. 增加测试，覆盖 token 校验、region 白名单、SDK invoke fallback、aws-router engine 参数解析、summary duration metrics 和 workflow 配置。

Target Lambda 要求：
- 只接收 Lambda invoke event。
- 不创建 Function URL。
- 校验 secid/klt/lmt/end。
- 请求东方财富 Kline API。
- 返回 ok/source_engine/source_region/target_duration_ms/eastmoney_duration_ms/data.klines。

Router Lambda 要求：
- 通过 Function URL 暴露 /health、/probe、/kline。
- /probe 和 /kline 校验 x-router-token。
- 从 TARGETS_JSON 读取 region -> function_name。
- 使用 AWS SDK InvokeFunction 调用 Target Lambda。
- region=auto 时按配置顺序 fallback。
- 单 region invoke timeout 默认 18000ms。
- 返回 attempted_regions、fallback_count、duration metrics。

部署脚本要求：
- 使用 AWS CLI。
- 支持重复执行。
- 默认复用已有 ROUTER_TOKEN；只有 --rotate-router-token 才轮换。
- 创建或更新 IAM role、target lambda、router lambda、router Function URL。
- 打包 Router 运行所需依赖，包括 @aws-sdk/client-lambda。
- Router IAM policy 只允许 InvokeFunction 到白名单 Target ARN。
- 输出 Router URL、Target ARNs、GitHub Secret 配置命令、本地测试命令。
- 不把 URL/token 写入仓库。

验收：
先运行：
  npm run check
  npm test
  bin/x doctor

部署后运行：
  AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x aws probe-router --secid 1.600519 --period daily
  AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x kline fetch 000001 --period daily --engine aws-router
  AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x kline sync data/universe/20260630 --period daily --engine aws-router --limit 10 --concurrency 4

提交信息：
  aws: add lambda router kline engine
```

## 15. 推荐提交拆分

```text
docs: tighten aws router probe plan
aws: add target kline lambda
aws: add router lambda invoke forwarder
aws: add deploy script for router lambdas
fetch: add aws-router kline engine
ci: allow daily workflow to use aws-router
README: document aws-router deployment and testing
```

如果一次性提交，也可以使用：

```text
aws: add lambda router kline engine
```

## 16. 最终验收标准

完成后，应满足：

```bash
npm run check
npm test
bin/x doctor
AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x aws probe-router --secid 1.600519 --period daily
AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x kline fetch 000001 --period daily --engine aws-router
AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x kline sync data/universe/20260630 --period daily --engine aws-router --limit 10 --concurrency 4
```

并且：

```text
无真实密钥提交
无 Function URL 提交
无 zip 包提交
Target Lambda 无公网 Function URL
aws engine 仍可用
local engine 仍可用
auto engine 语义不变
aws-router 可单独测试
GitHub Action 可手动选择 engine=aws-router
engine=aws-router 时 GitHub Actions 不需要 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```
