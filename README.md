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

### 数据处理
```bash
# 统计分析
/root/x/process/statistics.sh

# 格式化表格
/root/x/process/format_table.sh
```