# AWS Forwarder / Probe 实施计划

> 日期：2026-07-01  
> 目标：在不引入额外收费型 AWS 服务的前提下，新增一个通用但受控的 AWS Router / Forwarder / Probe 能力，用于统一 GitHub Actions 到多 Region Lambda 的入口、测试链路延迟、保留 AWS Region 作为访问东方财富的出口池。  
> 面向执行者：Codex / AI 开发代理。

## 1. 背景

当前 `x` 已经具备 `--engine aws`，可以通过 AWS Lambda 获取东方财富 Kline 数据。但在 GitHub Actions 中直接调用多个 AWS Region 时，存在下面问题：

1. 不同 Region 延迟差异明显。
2. 某些 Region 会很慢或偶发超时。
3. GitHub Actions 侧要承担 Region 轮询、失败识别、重试和 fallback。
4. 东财存在 IP 风控，需要继续保留 AWS Region 作为最终出口。
5. AWS 是免费账号，不希望引入 API Gateway、CloudFront、Global Accelerator、DynamoDB、Provisioned Concurrency 等额外费用风险。

因此，本阶段目标不是直接做复杂智能调度，而是先实现一个最小可用的 **Forwarder / Probe**：

```text
GitHub Actions / bin/x
  -> Router Lambda Function URL
  -> Target Lambda Function URL by Region
  -> Target Lambda 访问东方财富
  -> 返回 Kline + 延迟指标
```

第一版重点是：

```text
纯转发
固定白名单
Token 鉴权
Region 延迟测试
标准耗时指标
aws-router engine
A/B 测试 aws vs aws-router
```

## 2. 约束和非目标

### 2.1 必须遵守

```text
只使用 Lambda + Lambda Function URL
不使用 API Gateway
不使用 CloudFront
不使用 Global Accelerator
不使用 DynamoDB
不使用 S3 作为状态存储
不使用 SQS / Step Functions
不使用 Provisioned Concurrency
不提交任何 AWS Key / Token / Function URL
不提交 zip 包 / .env / credentials
```

### 2.2 安全边界

不能做开放代理。

禁止设计成：

```json
{
  "url": "https://任意网站.com"
}
```

只允许 Router 转发到配置白名单里的 Target Lambda Function URL：

```json
{
  "targets": {
    "ap-northeast-1": "https://xxx.lambda-url.ap-northeast-1.on.aws",
    "ap-southeast-1": "https://xxx.lambda-url.ap-southeast-1.on.aws"
  }
}
```

所有真实 URL 和 token 必须通过环境变量、GitHub Secrets、部署脚本输出或 `config/local.json` 管理，不允许写入仓库。

### 2.3 第一版非目标

第一版不做：

```text
复杂智能路由
持久化 Region 健康度
Dashboard
缓存
批量请求
Web UI
成本统计系统
全量自动切换默认 engine
```

第一版只需要支持单股请求和 Region probe。

## 3. 目标架构

```text
+----------------------+       +-----------------------------+
| GitHub Actions/bin/x | ----> | Router Lambda Function URL  |
+----------------------+       +-----------------------------+
                                      |
                                      | region=auto / specified
                                      v
                            +-----------------------------+
                            | Target Lambda Function URL  |
                            | ap-northeast-1 / ...        |
                            +-----------------------------+
                                      |
                                      v
                            +-----------------------------+
                            | Eastmoney Kline API         |
                            +-----------------------------+
```

### 3.1 Router Lambda 职责

```text
统一入口
校验外部 token
读取白名单 Target URLs
提供 /health
提供 /probe
提供 /kline
按 Region 转发请求
region=auto 时按配置顺序 fallback
记录 router_duration_ms / target_duration_ms / total_duration_ms
返回统一 JSON
```

### 3.2 Target Lambda 职责

```text
校验 internal token
只支持 kline 请求
构造东方财富 Kline URL
请求东方财富
返回兼容现有 fetch_kline.js 的结构
记录 eastmoney_duration_ms / target_duration_ms
```

## 4. AWS 资源设计

### 4.1 Target Lambda

每个目标 Region 部署一个同名函数，例如：

```text
kline-target
```

部署 Region 示例：

```text
ap-northeast-1
ap-northeast-2
ap-southeast-1
ap-southeast-2
us-west-2
```

第一版不要一口气部署全部 17 个 Region。先部署 3 到 5 个常用 Region 做 A/B 测试。

### 4.2 Router Lambda

只部署一个入口函数，例如：

```text
kline-router
```

推荐先部署在：

```text
ap-northeast-1
```

### 4.3 Function URL

Target Lambda 和 Router Lambda 都使用 Lambda Function URL。

第一版 AuthType 使用：

```text
NONE
```

但函数内部必须校验 token：

```text
Router 外部请求：x-router-token
Router 调 Target：x-internal-token
```

### 4.4 IAM

第一版函数只需要基本执行权限：

```text
AWSLambdaBasicExecutionRole
```

不要授予不必要权限。

如果部署脚本需要创建 IAM Role，需要最小化 policy。部署脚本只在用户本地或 GitHub Actions 部署环境执行，不要把部署权限写进函数。

## 5. Target Lambda 设计

新增目录：

```text
lambda/target-kline/
  index.mjs
  package.json
```

### 5.1 输入

Target Lambda 接收 POST JSON：

```json
{
  "secid": "0.000001",
  "klt": 101,
  "lmt": 100000,
  "end": "20991231"
}
```

Header：

```text
x-internal-token: <INTERNAL_TOKEN>
```

### 5.2 参数校验

必须校验：

```text
secid 格式：0.xxxxxx 或 1.xxxxxx
klt 只允许 101 / 106
lmt 必须是正整数，默认 100000
end 必须是 YYYYMMDD，默认 20991231
```

### 5.3 输出

成功返回：

```json
{
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
  "error": "Eastmoney request timeout",
  "source_engine": "aws-router-target",
  "source_region": "ap-northeast-1",
  "target_duration_ms": 3000,
  "error_class": "timeout"
}
```

### 5.4 超时要求

Target Lambda 总 timeout 建议：

```text
5 到 8 秒
```

Target 内部请求东方财富的超时建议：

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

### 6.1 环境变量

Router Lambda 使用：

```text
ROUTER_TOKEN
INTERNAL_TOKEN
TARGET_URLS_JSON
ROUTER_MAX_FALLBACKS
ROUTER_TARGET_TIMEOUT_MS
```

`TARGET_URLS_JSON` 示例：

```json
{
  "ap-northeast-1": "https://xxx.lambda-url.ap-northeast-1.on.aws",
  "ap-southeast-1": "https://xxx.lambda-url.ap-southeast-1.on.aws",
  "us-west-2": "https://xxx.lambda-url.us-west-2.on.aws"
}
```

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

返回：

```json
{
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

### 6.5 Region 策略

第一版 region 策略保持简单：

```text
如果 region 指定为具体值，只请求该 region
如果 region=auto，按 TARGET_URLS_JSON 的顺序尝试
单 region 超时后尝试下一个
最多 fallback 2 到 3 个 region
所有 region 失败则返回 502
```

不要第一版就做复杂健康状态持久化。

## 7. 部署脚本设计

新增：

```text
scripts/deploy-aws-router.sh
```

### 7.1 参数

```bash
scripts/deploy-aws-router.sh \
  --router-region ap-northeast-1 \
  --target-regions ap-northeast-1,ap-northeast-2,ap-southeast-1,us-west-2 \
  --target-name kline-target \
  --router-name kline-router \
  --memory 128 \
  --timeout 8
```

### 7.2 职责

部署脚本要完成：

```text
检查 aws CLI 是否存在
检查当前 AWS identity
生成随机 INTERNAL_TOKEN / ROUTER_TOKEN，或允许用户传入
打包 target lambda
打包 router lambda
创建或更新 IAM role
创建或更新 target lambda
创建或更新 target lambda Function URL
创建或更新 router lambda
创建或更新 router lambda Function URL
设置环境变量
输出部署结果
输出 GitHub Secret 配置命令
输出本地测试命令
```

### 7.3 重要要求

```text
不要提交 zip 文件
不要把 token 写入仓库
不要把 function url 写入仓库
不要自动改 config/kline.json 写入真实 URL
部署失败要有清晰错误信息
脚本需要支持重复执行，尽量 idempotent
```

### 7.4 部署输出示例

```text
Router URL:
  https://xxx.lambda-url.ap-northeast-1.on.aws

Target URLs:
  ap-northeast-1=https://xxx.lambda-url.ap-northeast-1.on.aws
  ap-southeast-1=https://xxx.lambda-url.ap-southeast-1.on.aws

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
parseArguments 支持 aws-router
config/kline.json 支持 aws_router_url
环境变量支持 AWS_ROUTER_URL / AWS_ROUTER_TOKEN
新增 fetchAwsRouterKline()
resolveKline 支持 engine=aws-router
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
```

### 8.2 `fetch/query_pool_klines.js`

修改：

```text
VALID_ENGINES 新增 aws-router
summary.engine_counts 支持 aws-router
summary.region_counts 记录 Router 返回的 source_region
summary 增加 duration 统计字段
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

### 8.3 `bin/x`

修改 help：

```text
--engine auto|local|aws|aws-router
```

新增命令：

```bash
bin/x aws probe-router --secid 1.600519 --period daily
```

输出 Router `/probe` 的结果。

### 8.4 `config/kline.json`

不要写真实 URL。

可以增加示例字段：

```json
{
  "aws_router_url_env": "AWS_ROUTER_URL",
  "aws_router_token_env": "AWS_ROUTER_TOKEN"
}
```

真实 URL 和 token 通过环境变量或 GitHub Secrets 提供。

## 9. GitHub Actions 集成

修改：

```text
.github/workflows/daily-data-commit.yml
```

### 9.1 engine options

增加：

```text
aws-router
```

### 9.2 env

增加：

```yaml
AWS_ROUTER_URL: ${{ secrets.AWS_ROUTER_URL }}
AWS_ROUTER_TOKEN: ${{ secrets.AWS_ROUTER_TOKEN }}
```

### 9.3 注意

```text
不要打印 AWS_ROUTER_URL
不要打印 AWS_ROUTER_TOKEN
engine=aws-router 时不需要配置 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
engine=aws 仍然保留旧逻辑
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
Target token 校验
Target 参数校验
Target 不允许任意 URL
Router token 校验
Router 只允许白名单 region
Router region=auto fallback
Router /probe 输出格式
fetch_kline.js 支持 aws-router
query_pool_klines.js 支持 aws-router
workflow engine options 包含 aws-router
```

验收命令：

```bash
npm run check
npm test
bin/x doctor
```

部署后验收：

```bash
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

如果 `aws-router` 明显更稳，再把 GitHub Action 手动默认 engine 调整为 `aws-router`。不要立即替换 `auto`。

## 12. 费用控制

为了适配 AWS 免费账号：

```text
Lambda memory 先用 128MB
Router timeout 8-12 秒
Target timeout 5-8 秒
不启用 Provisioned Concurrency
不使用 API Gateway / CloudFront / Global Accelerator
不使用 DynamoDB / SQS / Step Functions
外层 concurrency 从 4 开始
limit=50 做测试，再逐步放大
```

如果出现账单风险，立即回滚 workflow 默认 engine。

## 13. 回滚方式

代码回滚：

```text
保持 aws engine 不变
aws-router 作为新增 engine，不影响现有 aws/local
如果 aws-router 出问题，GitHub Action engine 改回 aws
```

AWS 资源回滚：

```bash
aws lambda delete-function --function-name kline-router --region ap-northeast-1
aws lambda delete-function --function-name kline-target --region ap-northeast-1
```

实际删除命令要根据部署脚本输出的函数名和 Region 执行。

## 14. Codex 执行提示词

下面内容可以直接交给 Codex。

```text
你正在维护 liqiangcc/x 仓库。请实现 docs/AWS_FORWARDER_PROBE_PLAN.md 中定义的 AWS Forwarder / Probe 方案。

目标：
在不使用 API Gateway、CloudFront、Global Accelerator、DynamoDB、SQS、Step Functions、Provisioned Concurrency 的前提下，新增一个低成本 aws-router engine，用 Lambda Function URL 实现统一入口、Region 转发、延迟测试和 fallback。

硬性约束：
1. 不提交任何真实 AWS key、token、Function URL。
2. 不提交 .env、credentials、zip 包。
3. 不创建或引用额外收费型 AWS 服务。
4. Router 不能做开放代理，不能接受任意 URL。
5. Router 只能转发到 TARGET_URLS_JSON 白名单里的 Target Lambda Function URL。
6. 第一版不做缓存、不做 DynamoDB、不做复杂健康状态持久化。
7. aws-router 是新增 engine，不能破坏现有 aws/local/auto 行为。

需要完成：
1. 新增 lambda/target-kline/index.mjs 和 package.json。
2. 新增 lambda/router/index.mjs 和 package.json。
3. 新增 scripts/deploy-aws-router.sh。
4. 修改 fetch/fetch_kline.js，支持 --engine aws-router。
5. 修改 fetch/query_pool_klines.js，允许 engine=aws-router，并记录 duration/region 指标。
6. 修改 bin/x，help 中加入 aws-router，并新增 bin/x aws probe-router。
7. 修改 .github/workflows/daily-data-commit.yml，engine options 加 aws-router，并传入 AWS_ROUTER_URL/AWS_ROUTER_TOKEN secrets。
8. 更新 README，说明部署、GitHub Secrets、A/B 测试命令和回滚方式。
9. 增加测试，覆盖 token 校验、region 白名单、fallback、aws-router engine 参数解析和 workflow 配置。

Target Lambda 要求：
- 校验 x-internal-token。
- 只支持 kline 请求。
- 校验 secid/klt/lmt/end。
- 请求东方财富 Kline API。
- 返回 source_engine/source_region/target_duration_ms/eastmoney_duration_ms/data.klines。

Router Lambda 要求：
- 校验 x-router-token。
- 支持 /health、/probe、/kline。
- 从 TARGET_URLS_JSON 读取 region -> target url。
- region=auto 时按配置顺序 fallback。
- 单 region timeout 默认 3000ms。
- 返回 attempted_regions、fallback_count、duration metrics。

部署脚本要求：
- 使用 AWS CLI。
- 支持重复执行。
- 创建或更新 IAM role、target lambda、target function url、router lambda、router function url。
- 输出 Router URL、Target URLs、GitHub Secret 配置命令、本地测试命令。
- 不把 URL/token 写入仓库。

验收：
先运行：
  npm run check
  npm test
  bin/x doctor

部署后运行：
  AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x kline fetch 000001 --period daily --engine aws-router
  AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' bin/x kline sync data/universe/20260630 --period daily --engine aws-router --limit 10 --concurrency 4

提交信息：
  aws: add lambda forwarder probe engine
```

## 15. 推荐第一批提交

Codex 实现时建议拆成几次提交：

```text
docs: add aws forwarder probe plan
aws: add target kline lambda
aws: add router lambda forwarder
aws: add deploy script for router lambdas
fetch: add aws-router kline engine
ci: allow daily workflow to use aws-router
README: document aws-router deployment and testing
```

如果 Codex 一次性提交，也可以使用：

```text
aws: add lambda forwarder probe engine
```

## 16. 最终验收标准

完成后，应满足：

```bash
npm run check
npm test
bin/x doctor
bin/x aws probe-router --secid 1.600519 --period daily
bin/x kline fetch 000001 --period daily --engine aws-router
bin/x kline sync data/universe/20260630 --period daily --engine aws-router --limit 10 --concurrency 4
```

并且：

```text
无真实密钥提交
无 Function URL 提交
无 zip 包提交
aws engine 仍可用
local engine 仍可用
aws-router 可单独测试
GitHub Action 可手动选择 engine=aws-router
```
