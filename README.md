# 股票数据账本工作区

`x` 是一个 Node.js-first 的 A 股数据采集、数据账本、信号研究和报告生成工作区。常规功能统一通过 `bin/x` 入口运行；历史 Python 和 Shell 脚本已经迁入 `legacy/`，只作参考和过渡，不再作为推荐入口。

## 环境要求

- Node.js 22+，数据库命令依赖 Node 内置 SQLite。
- Git，用于数据账本提交。
- 可选 AWS 凭证，用于 `--engine aws` 的 Lambda kline 获取。
- 可选 Huawei Cloud AK/SK 和 targets JSON，用于 `--engine huaweicloud` 或 `--engine auto` 的 FunctionGraph kline 获取。

安装依赖：

```bash
npm install
```

检查环境：

```bash
bin/x doctor
```

配置 AWS 密钥后检查 AWS 维护状态：

```bash
aws configure --profile default
bin/x aws status --profile default --region ap-northeast-1
```

## 目录地图

- `bin/x`：统一 CLI。
- `src/`：Node 模块，包含 HTTP、Eastmoney client、DB、proxy、stats 等实现。
- `api/call_ttjj_api.js`：Node 版 Eastmoney/Tiantian Fund API 兼容 CLI。
- `fetch/`：pool/kline 拉取和质量检查脚本，均为 Node。
- `utils/`：pool codes、交易日等 Node 工具。
- `data/`：可提交数据输出。
- `runs/`：运行记录、失败项、质量报告。
- `reports/`：每日候选报告。
- `tests/`：Node 单元测试。
- `legacy/`：旧 Python/Shell 脚本，仅作迁移参考。

关键设计文档：

- `docs/SIGNALS_DESIGN.md`：可扩展信号系统、基础能力枚举、`year_breakout` 定义和日报输出契约。

## 快速开始

最小闭环：

```bash
bin/x daily --latest --limit 10 --period daily
```

`daily` 默认使用沪深 A 股全市场 universe；不传 `--limit` 时会同步全市场股票 kline。需要回到旧的热点 pool 输入时，显式加 `--universe pool`。

GitHub Action 以稳定优先：默认使用 `aws-router`、kline 并发为 4，按缺失文件分批处理；已有 kline 文件会跳过，手动传 `force=true` 才会覆盖刷新。

指定日期：

```bash
bin/x daily --date 20260325 --limit 10 --period daily
```

提交数据账本：

```bash
bin/x daily --latest --limit 10 --period daily --commit
```

查看运行记录：

```bash
bin/x run list
bin/x run show <run_id>
bin/x run failures <run_id>
```

生成候选报告：

```bash
bin/x report daily --date 20260325
```

## 常用命令

Pool 和 codes：

```bash
bin/x pool pull --date 20260325
bin/x stocks fetch --date 20260325 --market hs-a
bin/x codes build data/pool/20260325
```

Kline：

```bash
bin/x kline fetch 000020 --period daily --engine local
bin/x kline sync data/universe/20260325 --period daily --limit 10
bin/x kline sync data/universe/20260325 --period daily --batch-size 500 --concurrency 1 --retry-attempts 3 --retry-concurrency 1
bin/x kline retry data/kline/daily/summary.daily.json --period daily --engine aws
bin/x kline sync data/pool/20260325 --period daily --limit 10
bin/x kline validate data/kline --period daily --json
```

AWS 密钥维护：

```bash
bin/x aws status --profile default --region ap-northeast-1
bin/x aws sync-github-secrets --profile default --region ap-northeast-1
bin/x kline fetch 600519 --period daily --engine aws --aws-region ap-northeast-1
```

`sync-github-secrets` 会从本地 AWS profile 读取长期 IAM access key，先用 `config/kline.json` 中的多 region 配置验证 Lambda kline 调用，再写入 GitHub `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` secrets 和 `AWS_REGION` variable。不要把真实密钥提交到仓库；如果 `origin` 不是 GitHub 仓库，使用 `--repo owner/name` 指定目标仓库。需要单独测试某个 region 时，加 `--preflight-region ap-northeast-1`。

AWS Router 部署和测试：

```bash
scripts/deploy-aws-router.sh \
  --router-region ap-northeast-1 \
  --target-regions ap-northeast-1,ap-northeast-2,ap-southeast-1,us-west-2 \
  --target-name kline-target \
  --router-name kline-router

AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' \
  bin/x aws probe-router --secid 1.600519 --period daily

AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' \
  bin/x kline fetch 000001 --period daily --engine aws-router

AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' \
  bin/x aws latency --engine both --region ap-northeast-1 --attempts 3

AWS_ROUTER_URL='...' AWS_ROUTER_TOKEN='...' \
  bin/x aws latency --engine aws-router --region all --attempts 1 --json

scripts/deploy-huaweicloud-functiongraph.sh \
  --all-regions \
  --output /tmp/huaweicloud-deploy.tsv \
  --targets-output /tmp/huaweicloud-targets.json

HUAWEICLOUD_ACCESS_KEY='...' HUAWEICLOUD_SECRET_KEY='...' \
  bin/x aws latency --engine huaweicloud \
  --huaweicloud-targets /tmp/huaweicloud-targets.json \
  --huaweicloud-region all \
  --attempts 1 --json

HUAWEICLOUD_ACCESS_KEY='...' HUAWEICLOUD_SECRET_KEY='...' \
  bin/x kline fetch 600519 --period daily --engine huaweicloud \
  --huaweicloud-targets /tmp/huaweicloud-targets.json \
  --huaweicloud-region cn-east-3

HUAWEICLOUD_ACCESS_KEY='...' HUAWEICLOUD_SECRET_KEY='...' \
  bin/x kline sync data/universe/20260325 --period daily --engine huaweicloud \
  --huaweicloud-targets /tmp/huaweicloud-targets.json \
  --huaweicloud-region all \
  --limit 10
```

`aws latency` 用于本地和 GitHub Action 对比 region 延迟；`--region r1,r2` 作用于当前 engine 选中的云函数入口，也可分别用 `--aws-region`、`--target-region`、`--huaweicloud-region` 覆盖。Huawei Cloud latency 不指定 `--huaweicloud-region` 或传 `all` 时，会测试 targets JSON 中全部已部署 region；只需要对比单一区域时才显式传 region。`both` 仍只跑 AWS Lambda 直连和 AWS Router；`all` 才会额外跑 Huawei Cloud FunctionGraph。`aws-router` 只需要 `AWS_ROUTER_URL` 和 `AWS_ROUTER_TOKEN`，不需要在 GitHub Actions 运行时配置 AWS access key。Huawei Cloud latency 和 kline 抓取需要 `HUAWEICLOUD_ACCESS_KEY`、`HUAWEICLOUD_SECRET_KEY` 和 `HUAWEICLOUD_TARGETS_JSON`；targets JSON 由 `scripts/deploy-huaweicloud-functiongraph.sh --targets-output` 生成，格式是按 region 映射 `project_id` 和 `function_urn`。latency benchmark 在 Huawei Cloud targets 缺失或为空时会生成失败报告和 artifact，不会因为配置缺失直接中断 workflow。AWS Router 部署脚本会输出 GitHub secret 设置命令；Huawei Cloud secrets/targets 统一手动写入 GitHub Secrets 或 Variables。不要提交真实 URL、token、密钥、targets JSON 或 zip 包。`auto` engine 会按 `huaweicloud -> aws -> local` 回退；旧 `aws` engine 仍可手动选择作为直连 Lambda 回退。

Eastmoney 超时调大只作为实验配置执行，不作为默认部署值。验证命令：

```bash
scripts/deploy-aws-router.sh \
  --target-regions ap-northeast-1,ap-northeast-2,ap-southeast-1,us-west-2 \
  --target-timeout 30 \
  --eastmoney-timeout-ms 8000 \
  --eastmoney-retries 3 \
  --router-target-timeout-ms 27000 \
  --router-max-fallbacks 4
```

API：

```bash
node api/call_ttjj_api.js get_kline 1.600519 101 100 20260325
node api/call_ttjj_api.js get_etfs
```

数据库和统计：

```bash
bin/x db init --db db/stocks.db
bin/x db query --db db/stocks.db --sql "select name from sqlite_master"
bin/x stats yearly-positive --db mydb.db --metric-column c4
bin/x stats new-highs --db mydb.db --year 2026
```

代理配置：

```bash
bin/x proxy list --config /opt/clash/runtime.yaml --group lx
bin/x proxy rotate --proxy <name> --config /opt/clash/runtime.yaml --group lx
bin/x proxy check
```

本机国内免费代理池（实验功能）：

```bash
cp ops/proxy-pool/.env.example ops/proxy-pool/.env
# 编辑 .env，设置随机的 PROXY_POOL_API_KEY（可用 openssl rand -hex 32 生成）
bin/x proxy pool up
bin/x proxy pool status
bin/x proxy pool warmup --duration 30m --samples 20
bin/x proxy pool benchmark --samples 100 --concurrency 4 --json
bin/x proxy pool verify --concurrency 8 --timeout-ms 6000
bin/x kline fetch 600519 --period daily --policy proxy-first
```

只读检查本地 Kline 最新日期分布，并生成可直接补数的代码清单：

```bash
bin/x kline freshness data/kline --period daily \
  --codes data/universe/20260701/codes.json \
  --expected-latest-date 20260710 \
  --repair-output /tmp/stale-daily.json --json
bin/x kline sync /tmp/stale-daily.json --period daily --policy proxy-only \
  --refresh-mode incremental --expected-latest-date 20260710 \
  --freshness-codes /tmp/stale-daily.json --proxy-preflight \
  --concurrency auto --checkpoint-every 50
```

未指定 `--expected-latest-date` 时，检查器使用有效文件最新日期分布的众数（并列取较新日期）。修复清单包含过期、缺失和无效文件；检查命令本身不会抓取或修改数据。

`kline sync` 默认使用增量刷新：已有合法文件只请求覆盖缺口的安全窗口并按日期合并，缺失或无效文件才请求完整历史。`--refresh-mode full` 强制完整刷新，建议由外部周任务用于校准前复权历史。`proxy-only` 默认先并发验证代理，至少 5 个节点且成功率达到 60% 才开始；单进程批量 session 会复用候选、连接和内存健康状态。

免费代理同步首轮默认每只股票只尝试一次，失败写入 `var/kline-sync/failures/<period>.json`，不会原地重试拖慢主队列。到达退避时间后单独消费：

```bash
bin/x kline retry-queue var/kline-sync/failures/daily.json --policy proxy-only --concurrency 2
bin/x proxy pool diagnose --samples 100 --concurrency 16 --timeout-ms 3000 --json
bin/x proxy pool probe --duration 10m --interval 30s --samples 20 --concurrency 2 --hard-deadline-ms 5000
bin/x proxy pool select --min-samples 5 --min-success-rate 0.8 --max-p95-ms 3000 --limit 5
bin/x benchmark proxy-sync --codes data/universe/20260701/codes.json --period daily --samples 100 --expected-latest-date 20260710 --json
bin/x benchmark kline-engines --engines local,proxy-pool,aws,aws-router,huaweicloud --code 600519 --period daily --lmt 1 --attempts 3 --json
```

代理连接固定 2 秒超时；`proxy-only` 响应头最多等待 10 秒，增量请求总 deadline 为 15 秒。失败队列按错误类型退避，累计三轮失败后进入同目录的 `.dead.json` 文件。

每个周期只允许一个同步进程，锁位于 `var/kline-sync/locks/`。可用 `bin/x kline sync-status` 查看；只有确认进程已结束后才使用 `bin/x kline unlock --period daily` 清理过期锁。`reliable-fastest` selector 先筛选最近 10 分钟成功、至少 3 个样本且成功率不低于 60% 的节点，再按 P95 延迟排序。

`benchmark kline-engines` 使用相同股票、周期、K线条数和尝试次数依次比较各引擎，输出成功率、平均值、P50/P95/P99、实际区域和错误分类。缺少凭证或目标配置的引擎会记录为 `unconfigured`，不会中断其他引擎测试；完整报告写入 `runs/benchmark/kline-engines/`。

`proxy pool select` 从真实 Kline 健康样本生成 `var/proxy-pool/selected.json`。`proxy-only` 只使用这份核心列表，列表缺失、为空或超过一小时未更新时快速失败，不会退回完整免费代理池；先执行 `proxy pool verify` 和 `proxy pool select` 再启动同步。

`proxy-first` 同样先使用核心列表中的最佳代理，失败后依次回退 AWS Router、AWS 和本地直连，不经过 Huawei Cloud；`proxy-only` 则不做任何引擎回退。

代理池固定使用 `Python3WebSpider/ProxyPool` 的已验证提交，通过 `area=CN` 做国内候选粗筛；`x` 会再次使用严格 TLS 请求 Eastmoney Kline，验证 JSON 和非空 K 线后才接受代理。`verify` 会逐个验证当前所有候选，并在 `runs/proxy-verify/` 下生成完整报告和按延迟排序的 `available.txt`；可用 `--limit N` 做小规模检查，或用 `--output file` 指定 JSON 报告。健康状态保存在忽略目录 `var/proxy-pool/`。免费代理失败时批量 Kline 会沿用现有本地 fallback；`auto` 和 GitHub Actions 默认仍使用原有云端链路。

Kline 数据源通过 `config/kline.json` 中的命名策略编排。默认 `auto` 保持云端到本地的安全链路；另有 `proxy-first`、`proxy-only` 和 `cloud-first`。`--engine` 仍可作为单引擎快捷方式，但新调用应优先使用 `--policy`。代理内部按 provider、transport、目标探针、健康存储和 selector 分层；健康 JSON v2 按目标保存最近 20 次样本，默认 `balanced` selector 综合近期成功率和延迟并保留少量新节点探索。

## 数据约定

允许提交：

```text
data/pool/<YYYYMMDD>/
data/universe/<YYYYMMDD>/
data/kline/<period>/<prefix>/<code>.json
runs/<run_id>/
reports/<YYYYMMDD>/
```

不作为常规数据提交：

```text
*.log
*.db
*.sqlite
*.duckdb
node_modules/
.env
config/local.json
```

## 验证

```bash
npm run check
npm test
bin/x kline validate data/kline --period daily --json
```

## GitHub Actions 云端抓取配置

Daily Action 默认使用 `aws-router`，只依赖 `AWS_ROUTER_URL` 和 `AWS_ROUTER_TOKEN` secrets；手动选择 `huaweicloud` 时使用 Huawei Cloud Secrets；手动选择 `aws` 或 `auto` 时才使用 GitHub Secrets 中维护的 AWS 长期访问密钥，不再依赖 OIDC role。

默认配置不传 `limit`，会先确保 `data/universe/<YYYYMMDD>/codes.json` 的沪深 A 股全市场股票清单存在，再通过 `aws-router` 同步全部 kline。同一交易日已有完整 market universe 时会复用；手动触发时可用 `force_universe=true` 强制刷新，用 `limit=10` 做小范围验证，或选择 `universe=pool` 回到旧的 pool 输入。
Action job 显式设置 `timeout-minutes: 360`，这是 GitHub-hosted runner 单 job 的 6 小时上限。默认不强制刷新已有 kline，而是按下一批缺失代码续跑。Latency Benchmark Action 不写数据、不提交，只上传 `latency-results.json` artifact。

- 默认 `aws-router` engine 必需 secrets：`AWS_ROUTER_URL`、`AWS_ROUTER_TOKEN`
- 手动选择 `huaweicloud` 时必需 secrets：`HUAWEICLOUD_ACCESS_KEY`、`HUAWEICLOUD_SECRET_KEY`、`HUAWEICLOUD_TARGETS_JSON`
- 手动选择 `aws` 或 `auto` 时必需 secrets：`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`
- 可选 variable：`AWS_REGION`，默认 `ap-northeast-1`
- IAM 最小权限：允许调用 `config/kline.json` 中配置的 Lambda，默认函数名 `kline`
- 批量 AWS kline 会按代码索引轮询起始 region，并在失败时继续 fallback 到其余 region。
- 批量 Huawei Cloud kline 会按 targets JSON 中的区域轮询，手动触发可用 `huaweicloud_region` 限定区域。
- 批量 `aws-router` kline 会通过 Router Function URL 访问白名单 Target Lambda，并记录 `region_counts`、`fallback_count` 和 duration 指标。
- 批量失败后会对 transient 网络错误串行重试；仍失败时可用 `bin/x kline retry <summary.json|failures.json>` 只重跑失败项。
- 默认 Action 参数：`batch_size=100`、`concurrency=4`、daily `retry_attempts=3`、yearly `retry_attempts=5`、`retry_concurrency=1`；yearly 建议手动分批运行。
- 默认 Router target region：`ap-northeast-1`, `ap-northeast-2`, `ap-southeast-1`, `us-west-2`。
- 当前可轮询 region：`ap-northeast-1`, `ap-northeast-2`, `ap-northeast-3`, `ap-south-1`, `ap-southeast-1`, `ap-southeast-2`, `ca-central-1`, `eu-central-1`, `eu-north-1`, `eu-west-1`, `eu-west-2`, `eu-west-3`, `sa-east-1`, `us-east-1`, `us-east-2`, `us-west-1`, `us-west-2`。

不要把验证生成的数据、报告或运行记录混入代码提交，除非本次提交目标就是数据刷新。
