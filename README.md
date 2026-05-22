# 股票数据脚本使用手册

这是一个 script-first 的股票数据工作区，主要通过 Bash 和 Node.js 脚本完成行情 API 调用、代理轮换、pool 数据拉取、股票代码提取、kline 数据生成、数据库导入和结果处理。日常使用通常从仓库根目录直接运行脚本，没有单独的构建步骤。

生成数据集中放在 `data/` 和 `eastmoney_data/` 下。`data/pool/<YYYYMMDD>/`、`data/kline/daily/`、`data/kline/yearly/` 都是脚本输出目录，除非正在做明确的数据刷新，否则不要手工编辑这些 JSON 文件，也不要把它们混入普通脚本或文档提交。

## 目录地图

### `api/` - API 调用入口

- `call_ttjj_api.sh` - 直接调用天天基金/东方财富 API，适合快速、小批量或已确认代理状态的场景。
- `call_api_with_proxy.sh` - 带代理管理和自动重试的 API 调用入口，适合关键请求。
- `call_api_batch.sh`、`call_api_with_rate_limit.sh` - 批量或限速调用辅助脚本。
- `parse_etf_details.py`、`etf.json` - ETF 数据解析和样例数据。

### `fetch/` - 数据获取和 kline 生成

- `pull_pool_task.js` - 拉取指定交易日或最近交易日的 pool 数据。
- `fetch_pool.js`、`extract_jsonp.js` - 底层 pool 请求和 JSONP 解析辅助脚本。
- `query_pool_klines.js` - 根据 `codes.json` 批量生成日线或年线 kline 文件。
- `fetch_kline.js` - 单只股票 kline 获取入口，支持本机/AWS 自动切换。
- `check_kline_empty.js` - 巡检 kline JSON 是否为空、结构异常或缺少 `data.klines`。
- `fetch_all_sectors.sh`、`fetch_sector_stocks.sh`、`fetch_and_store.sh`、`fetch_data.sh`、`fetch_tiantian_fund_data.sh` - 行业、板块和其他数据获取脚本。

### `utils/` - 数据整理工具

- `parse_pool_json.js` - 从 pool JSON 提取去重股票代码、平铺字段或生成 `codes.json`。
- `generate_pool_codes_batch.js`、`merge_pool_codes.js`、`generate_trading_days.js` - 批量生成、合并代码和交易日辅助工具。
- `q.sh`、`scode.sh`、`f_all_codes.sh`、`q_all_full_codes.sh`、`u_code_2_full.sh`、`u_code_full.sh` - 股票代码查询和格式转换工具。

### `proxy/` - 代理管理

- `proxy_manager.sh` - 主要代理管理脚本，支持检查、随机选择和轮换。
- `test_and_rotate_proxy.sh` - 检测当前 IP 状态并在需要时轮换代理。
- `test_proxies.sh`、`rotate_proxy.sh`、`check_proxies.sh`、`clash_as.sh`、`test_proxy_system.sh` - 代理测试、手动轮换和 Clash/mihomo 辅助脚本。

### `db/` - 数据库脚本和 schema

- `database_schema.sql` - 数据库 schema。
- `init_db.sh`、`createTable.sh` - 初始化数据库和建表。
- `load_data_to_db.sh`、`*_2_db.sh`、`save_ttjj_to_db.py` - 数据导入脚本。
- `sql.sh` - SQL 查询入口。

### `process/` - 结果处理和统计

- `statistics.sh`、`statistics.py` - 统计分析入口。
- `format_table.sh` - 表格格式化。
- `calc_diff_pct.sh`、`concat_line.sh`、`avg.sh` - 行数据处理辅助脚本。
- `get_year_exceed_dates.js`、`select_limit_up_year_breakout.js` - 年线突破和涨停相关筛选脚本。

### `config/` - 运行配置

- `kline.json` - kline 获取默认配置，包括 AWS region 列表和 Lambda 名称；`fetch_kline.js` 与 `query_pool_klines.js` 默认读取它。

### `data/` 和 `eastmoney_data/` - 生成输出

- `data/pool/<YYYYMMDD>/` - 每个交易日的 `dt.json`、`qs.json`、`zb.json`、`zt.json` 和 `codes.json`。
- `data/pool/summary.json` - 多日 pool 拉取任务汇总。
- `data/kline/daily/<code>.json` - 个股日线。
- `data/kline/yearly/<code>.json` - 个股年线。

## 快速开始：Pool -> Codes -> Kline

下面是最小可执行路径。先用小范围命令确认环境、代理和输出结构正常，再扩大日期范围或移除 `--limit`。

```bash
# 1. 拉取最近一个交易日的 pool 数据
node fetch/pull_pool_task.js --days 0 --output-dir data/pool

# 2. 从某一天的 pool 数据里生成去重股票代码
node utils/parse_pool_json.js data/pool/20260325 --codes-only

# 3. 先拉取少量日线做验证
node fetch/query_pool_klines.js data/pool/20260325 --period daily --limit 10

# 4. 检查日线 JSON 是否为空或结构异常
node fetch/check_kline_empty.js data/kline --period daily
```

如果小范围验证通过，再按需要拉取完整日线或年线：

```bash
node fetch/query_pool_klines.js data/pool/20260325 --period daily
node fetch/query_pool_klines.js data/pool/20260325 --period yearly
```

### 工作流脚本职责

- `fetch/pull_pool_task.js` 拉取 pool 原始数据，默认输出到 `data/pool/<YYYYMMDD>/`，包含 `dt.json`、`qs.json`、`zb.json`、`zt.json` 等文件。
- `utils/parse_pool_json.js` 解析 pool JSON；目录输入配合 `--codes-only` 时会写入 `data/pool/<YYYYMMDD>/codes.json`。
- `fetch/query_pool_klines.js` 读取 `codes.json` 并批量调用 `fetch_kline.js`，默认写入 `data/kline/<period>/<code>.json`。
- `fetch/fetch_kline.js` 获取单只股票 kline，默认 `--engine auto`，优先 AWS 多 region 轮换，失败再回退本机。
- `fetch/check_kline_empty.js` 巡检 `data/kline` 下的 JSON 文件，发现空文件、无效 JSON、缺少 `data.klines` 或 kline 数组为空时退出码为 `1`。

### Pool 和 Kline 常用命令

```bash
# 拉取指定交易日的 pool 数据
node fetch/pull_pool_task.js 20260325 --output-dir data/pool

# 拉取最近 21 个交易日的 pool 数据
node fetch/pull_pool_task.js --range-days 21 --output-dir data/pool

# 输出指定字段，方便人工检查
node utils/parse_pool_json.js data/pool/20260325 --flat --fields code,name,pool_type

# 强制重拉已存在的 kline 文件
node fetch/query_pool_klines.js data/pool/20260325 --period yearly --force

# 单只股票直接拉 kline
node fetch/fetch_kline.js 000035 --period daily
node fetch/fetch_kline.js 600137 --period yearly

# 显式指定引擎或配置文件
node fetch/fetch_kline.js 000035 --period daily --engine aws
node fetch/fetch_kline.js 000035 --period daily --config config/kline.json
node fetch/query_pool_klines.js data/pool/20260325 --period daily --engine auto
```

Kline 默认读取 `config/kline.json`，其中包含 `aws_regions` 和 `lambda_name`。命令行传 `--aws-region`、`--lambda-name` 或 `--config` 时会覆盖默认配置。`query_pool_klines.js` 默认跳过已存在的 `<code>.json`，只有传 `--force` 才会重拉。

## 使用方法

### 代理管理
```bash
# 检查IP状态
/root/x/proxy/proxy_manager.sh check

# 随机选择代理（快速）
/root/x/proxy/proxy_manager.sh random-fast

# 随机选择代理（带测试）
/root/x/proxy/proxy_manager.sh rotate-random

# 列出所有代理
/root/x/proxy/proxy_manager.sh list
```

### API调用
```bash
# 纯API调用（无代理管理，速度快）
/root/x/api/call_ttjj_api.sh get_kline 1.600519 101 100 20250906

# 带代理管理的API调用（自动重试，可靠性高）
/root/x/api/call_api_with_proxy.sh get_kline 1.600519 101 100 20250906

# 启用调试模式
DEBUG_MODE=true /root/x/api/call_api_with_proxy.sh get_kline 1.600519 101 100 20250906

# 禁用代理轮换
DISABLE_PROXY_ROTATION=true /root/x/api/call_api_with_proxy.sh get_kline 1.600519 101 100 20250906

# 获取行业板块
/root/x/api/call_ttjj_api.sh get_sectors 1
/root/x/api/call_api_with_proxy.sh get_sectors 1

# 获取板块股票
/root/x/api/call_ttjj_api.sh get_stocks BK0433 1
/root/x/api/call_api_with_proxy.sh get_stocks BK0433 1
```

**脚本区别：**
- `call_ttjj_api.sh`: 纯API调用，速度快，适合批量调用
- `call_api_with_proxy.sh`: 包含代理管理和自动重试，适合关键操作

**环境变量：**
- `DEBUG_MODE=true`: 启用调试日志输出
- `DISABLE_PROXY_ROTATION=true`: 禁用代理轮换

**使用示例：**
```bash
# 正常模式（无日志输出）
/root/x/api/call_api_with_proxy.sh get_kline 1.600519 101 100 20250906

# 调试模式（显示详细日志）
export DEBUG_MODE=true
/root/x/api/call_api_with_proxy.sh get_kline 1.600519 101 100 20250906

# 禁用代理轮换（仅使用当前代理）
export DISABLE_PROXY_ROTATION=true
/root/x/api/call_api_with_proxy.sh get_kline 1.600519 101 100 20250906

# 组合使用
export DEBUG_MODE=true DISABLE_PROXY_ROTATION=true
/root/x/api/call_api_with_proxy.sh get_kline 1.600519 101 100 20250906
```

### 数据库操作
```bash
# 初始化数据库
/root/x/db/init_db.sh

# 加载数据
/root/x/db/load_data_to_db.sh

# 执行SQL查询
/root/x/db/sql.sh
```

### 数据获取
```bash
# 获取所有行业板块
/root/x/fetch/fetch_all_sectors.sh

# 获取并存储数据
/root/x/fetch/fetch_and_store.sh
```

### 数据处理
```bash
# 统计分析
/root/x/process/statistics.sh

# 格式化表格
/root/x/process/format_table.sh
```
