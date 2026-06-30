# 股票数据账本工作区

`x` 是一个 Node.js-first 的 A 股数据采集、数据账本、信号研究和报告生成工作区。常规功能统一通过 `bin/x` 入口运行；历史 Python 和 Shell 脚本已经迁入 `legacy/`，只作参考和过渡，不再作为推荐入口。

## 环境要求

- Node.js 22+，数据库命令依赖 Node 内置 SQLite。
- Git，用于数据账本提交。
- 可选 AWS 凭证，用于 `--engine aws` 的 Lambda kline 获取。

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

## 快速开始

最小闭环：

```bash
bin/x daily --latest --limit 10 --period daily
```

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
bin/x codes build data/pool/20260325
```

Kline：

```bash
bin/x kline fetch 000020 --period daily --engine local
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

## 数据约定

允许提交：

```text
data/pool/<YYYYMMDD>/
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

## GitHub Actions AWS 配置

Daily Action 使用 GitHub Secrets 中维护的 AWS 长期访问密钥，不再依赖 OIDC role。

- 必需 secrets：`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`
- 可选 variable：`AWS_REGION`，默认 `ap-northeast-1`
- IAM 最小权限：允许调用 `config/kline.json` 中配置的 Lambda，默认函数名 `kline`

不要把验证生成的数据、报告或运行记录混入代码提交，除非本次提交目标就是数据刷新。
