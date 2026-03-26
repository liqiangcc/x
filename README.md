# 脚本目录结构说明

## 功能分类目录

### /root/x/proxy/ - 代理管理脚本
- `proxy_manager.sh` - 主要的代理管理脚本，支持随机选择
- `test_and_rotate_proxy.sh` - 测试并轮换代理
- `test_proxies.sh` - 测试所有代理
- `rotate_proxy.sh` - 手动轮换代理
- `check_proxies.sh` - 检查代理状态
- `clash_as.sh` - Clash自动切换脚本
- `test_proxy_system.sh` - 代理系统测试脚本

### /root/x/api/ - API调用脚本
- `call_ttjj_api.sh` - 纯API调用脚本（无代理管理）
- `call_api_with_proxy.sh` - 带代理管理的API调用脚本

### /root/x/db/ - 数据库相关脚本
- `init_db.sh` - 初始化数据库
- `load_data_to_db.sh` - 加载数据到数据库
- `createTable.sh` - 创建数据表
- `sql.sh` - SQL查询工具
- `*_2_db.sh` - 各种数据导入数据库的脚本

### /root/x/fetch/ - 数据获取脚本
- `check_kline_empty.js` - 检查 kline 文件是否为空或结构异常
- `fetch_all_sectors.sh` - 获取所有行业板块
- `fetch_and_store.sh` - 获取并存储数据
- `fetch_data.sh` - 获取数据
- `fetch_sector_stocks.sh` - 获取板块股票
- `fetch_tiantian_fund_data.sh` - 获取天天基金数据

### /root/x/process/ - 数据处理脚本
- `statistics.sh` - 统计分析
- `format_table.sh` - 格式化表格
- `calc_diff_pct.sh` - 计算差值百分比
- `concat_line.sh` - 连接行
- `avg.sh` - 计算平均值

### /root/x/utils/ - 工具脚本
- `q.sh` - 查询工具
- `scode.sh` - 股票代码工具
- `f_all_codes.sh` - 获取所有代码
- `u_code_2_full.sh` - 更新代码为完整格式
- `q_all_full_codes.sh` - 查询所有完整代码
- `u_code_full.sh` - 更新完整代码

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

### Pool -> Codes -> Kline 工作流
```bash
# 1. 拉取最近 21 个交易日的 pool 数据
node /root/x/fetch/pull_pool_task.js --range-days 21 --output-dir data/pool

# 2. 从某一天的 pool 数据里提取去重后的股票代码
node /root/x/utils/parse_pool_json.js /root/x/data/pool/20260325 --codes-only

# 3. 根据 codes.json 批量拉取日线
node /root/x/fetch/query_pool_klines.js /root/x/data/pool/20260325 --period daily

# 4. 根据 codes.json 批量拉取年线
node /root/x/fetch/query_pool_klines.js /root/x/data/pool/20260325 --period yearly
```

默认输出目录：
- `data/pool/<YYYYMMDD>/` - 每个交易日的 `dt.json`、`qs.json`、`zb.json`、`zt.json` 和 `codes.json`
- `data/pool/summary.json` - 多日拉取任务汇总
- `data/kline/daily/<code>.json` - 个股日线
- `data/kline/yearly/<code>.json` - 个股年线

Kline 默认配置文件：
- `config/kline.json` - 默认 `aws_regions` 列表和 `lambda_name`
- `fetch_kline.js`、`query_pool_klines.js` 默认先读取这个配置文件
- 命令行传 `--aws-region`、`--lambda-name`、`--config` 时会覆盖默认配置

常用命令：
```bash
# 拉取最近一个交易日的 pool 数据
node /root/x/fetch/pull_pool_task.js --days 0 --output-dir data/pool

# 拉取指定交易日的 pool 数据
node /root/x/fetch/pull_pool_task.js 20260325 --output-dir data/pool

# 只提取 code 列表，默认写入 data/pool/<date>/codes.json
node /root/x/utils/parse_pool_json.js /root/x/data/pool/20260325 --codes-only

# 输出指定字段，方便查询
node /root/x/utils/parse_pool_json.js /root/x/data/pool/20260325 --flat --fields code,name,pool_type

# 只拉一部分股票做测试
node /root/x/fetch/query_pool_klines.js /root/x/data/pool/20260325 --period daily --limit 10

# 强制重拉已存在的 kline 文件
node /root/x/fetch/query_pool_klines.js /root/x/data/pool/20260325 --period yearly --force

# 单只股票直接拉 kline，默认 auto: 优先 AWS，多 region 轮换，失败再回退本机
node /root/x/fetch/fetch_kline.js 000035 --period daily
node /root/x/fetch/fetch_kline.js 600137 --period yearly

# 检查 kline 文件是否为空、无效 JSON、缺少 data.klines 或 klines 为空
node /root/x/fetch/check_kline_empty.js
node /root/x/fetch/check_kline_empty.js /root/x/data/kline --period daily
node /root/x/fetch/check_kline_empty.js /root/x/data/kline --period yearly
node /root/x/fetch/check_kline_empty.js /root/x/data/kline --json

# 显式指定引擎或配置文件
node /root/x/fetch/fetch_kline.js 000035 --period daily --engine aws
node /root/x/fetch/fetch_kline.js 000035 --period daily --config /root/x/config/kline.json
node /root/x/fetch/query_pool_klines.js /root/x/data/pool/20260325 --period daily --engine auto
```

说明：
- `pull_pool_task.js` 默认优先使用 `curl` 引擎，失败时会自动回退到另一种引擎。
- 多日拉取按最近交易日向前倒序执行，遇到更早的整天空池边界会停止继续向前拉取。
- `parse_pool_json.js` 在目录输入下支持直接生成 `codes.json`，适合后续批量拉取 k 线。
- `fetch_kline.js` 是底层单只 kline 获取脚本，默认 `engine=auto`，负责 `local/aws` 切换、AWS region 轮换、读取 `config/kline.json` 和统一输出格式。
- `query_pool_klines.js` 默认写入 `data/kline`，内部调用 `fetch_kline.js`；默认也使用 `engine=auto`，已存在的 `<code>.json` 会自动跳过，除非传 `--force`。
- `check_kline_empty.js` 用于巡检 `data/kline` 下的 JSON 文件，识别空文件、无效 JSON、缺少 `data.klines`、`klines` 不是数组或空数组；发现问题时退出码为 `1`，方便接入批处理。
- AWS region 列表当前已经实测通过，`config/kline.json` 里的所有 region 都可调用 `kline` Lambda。

### 数据处理
```bash
# 统计分析
/root/x/process/statistics.sh

# 格式化表格
/root/x/process/format_table.sh
```
