#!/bin/bash

# 单线路API压力测试脚本
# 使用单一代理，30秒间隔，调用5000次，测试是否会被封禁

# 配置参数
TOTAL_CALLS=5000
CALL_INTERVAL=30  # 30秒间隔
PROXY_NAME="default"  # 使用直连模式
LOG_FILE="single_line_test_$(date +%Y%m%d_%H%M%S).log"
RESULT_FILE="single_line_results_$(date +%Y%m%d_%H%M%S).csv"

# API命令和参数
API_COMMAND="get_kline"
# 从数据库查询所有股票代码
STOCK_CODES_FILE="stock_codes_from_db.txt"

# 如果股票代码文件不存在，则从数据库查询
if [ ! -f "$STOCK_CODES_FILE" ]; then
    log "从数据库查询股票代码..."

    # 尝试从不同的数据库文件查询股票代码
    if [ -f "stocks.db" ]; then
        sqlite3 stocks.db "SELECT DISTINCT stock_code FROM stocks WHERE stock_code IS NOT NULL AND stock_code != '' ORDER BY stock_code;" > "$STOCK_CODES_FILE"
    elif [ -f "stock.db" ]; then
        sqlite3 stock.db "SELECT DISTINCT stock_code FROM stocks WHERE stock_code IS NOT NULL AND stock_code != '' ORDER BY stock_code;" > "$STOCK_CODES_FILE"
    elif [ -f "mydb.db" ]; then
        sqlite3 mydb.db "SELECT DISTINCT stock_code FROM stocks WHERE stock_code IS NOT NULL AND stock_code != '' ORDER BY stock_code;" > "$STOCK_CODES_FILE"
    else
        log "错误: 找不到数据库文件，请检查 stocks.db, stock.db 或 mydb.db"
        exit 1
    fi

    STOCK_COUNT=$(wc -l < "$STOCK_CODES_FILE")
    log "从数据库查询到 $STOCK_COUNT 个股票代码"

    if [ $STOCK_COUNT -eq 0 ]; then
        log "错误: 数据库中没有找到股票代码"
        exit 1
    fi
fi

# 初始化计数器
current_call=0
success_count=0
fail_count=0
start_time=$(date +%s)

# 创建日志文件
echo "=== 单线路API压力测试 ===" > "$LOG_FILE"
echo "开始时间: $(date)" >> "$LOG_FILE"
echo "总调用次数: $TOTAL_CALLS" >> "$LOG_FILE"
echo "调用间隔: $CALL_INTERVAL 秒" >> "$LOG_FILE"
echo "代理线路: $PROXY_NAME" >> "$LOG_FILE"
echo "======================================" >> "$LOG_FILE"

# 创建结果文件CSV头
echo "timestamp,call_number,stock_code,status,response_time,result" > "$RESULT_FILE"

# 日志函数
log() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# 获取当前实际使用的代理
get_current_proxy() {
    if [ -f "/tmp/current_proxy_id" ]; then
        cat "/tmp/current_proxy_id"
    else
        echo "$PROXY_NAME"
    fi
}

# 清理函数
cleanup() {
    log "脚本被中断，正在清理..."
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log "测试中断统计:"
    log "总调用次数: $current_call"
    log "成功次数: $success_count"
    log "失败次数: $fail_count"
    log "总耗时: $duration 秒"
    log "平均调用间隔: $(( duration / (current_call + 1) )) 秒"
    exit 1
}

# 设置中断处理
trap cleanup SIGINT SIGTERM

# 检查依赖
if [ ! -f "/root/x/api/call_api_with_rate_limit.sh" ]; then
    log "错误: 找不到 call_api_with_rate_limit.sh 脚本"
    exit 1
fi

log "开始单线路API压力测试..."
log "使用代理: $PROXY_NAME"
log "目标调用次数: $TOTAL_CALLS"
log "调用间隔: $CALL_INTERVAL 秒"
log "股票代码数量: $(wc -l < "$STOCK_CODES_FILE")"
log "股票代码文件: $STOCK_CODES_FILE"

# 主要测试循环
while [ $current_call -lt $TOTAL_CALLS ]; do
    current_call=$((current_call + 1))
    call_start_time=$(date +%s)

    # 获取当前股票代码（循环使用）
    stock_line=$(( (current_call - 1) % $(wc -l < "$STOCK_CODES_FILE") + 1 ))
    current_stock=$(sed -n "${stock_line}p" "$STOCK_CODES_FILE")
    API_PARAMS="$current_stock 101 100 20250906"

    log "第 $current_call/$TOTAL_CALLS 次调用开始... 股票代码: $current_stock"

    # 设置环境变量并调用API
    export DEBUG_MODE="true"
    export DISABLE_PROXY_ROTATION="true"
    export MIN_CALL_INTERVAL="$CALL_INTERVAL"

    # 调用API并记录结果
    call_result=$(timeout 60 /root/x/api/call_api_with_rate_limit.sh "$API_COMMAND" $API_PARAMS 2>&1)
    call_exit_code=$?
    call_end_time=$(date +%s)
    response_time=$((call_end_time - call_start_time))

    # 获取实际使用的代理线路
    actual_proxy=$(get_current_proxy)

    # 判断调用结果
    if [ $call_exit_code -eq 0 ] && [ -n "$call_result" ]; then
        success_count=$((success_count + 1))
        status="SUCCESS"
        result_summary="${call_result:0:100}"  # 只记录前100个字符
        log "✅ 第 $current_call 次调用成功 [线路: $actual_proxy] [股票: $current_stock] [响应: ${response_time}s]"
        echo "$(date +%s),$current_call,$current_stock,$status,$response_time,\"$result_summary\"" >> "$RESULT_FILE"
    else
        fail_count=$((fail_count + 1))
        status="FAILED"
        error_msg="${call_result:0:100}"
        log "❌ 第 $current_call 次调用失败 [线路: $actual_proxy] [股票: $current_stock] [响应: ${response_time}s] - $error_msg"
        echo "$(date +%s),$current_call,$current_stock,$status,$response_time,\"$error_msg\"" >> "$RESULT_FILE"

        # 如果连续失败超过10次，停止测试
        if [ $fail_count -ge 10 ]; then
            log "连续失败次数过多，可能已被封禁，停止测试"
            break
        fi
    fi

    # 显示进度
    if [ $((current_call % 50)) -eq 0 ]; then
        local elapsed_time=$((call_end_time - start_time))
        local avg_interval=$((elapsed_time / current_call))
        local success_rate=$((success_count * 100 / current_call))
        local current_proxy=$(get_current_proxy)
        log "📊 进度更新 - 完成: $current_call/$TOTAL_CALLS ($((current_call * 100 / TOTAL_CALLS))%)"
        log "   成功率: $success_rate% | 成功: $success_count | 失败: $fail_count"
        log "   当前线路: $current_proxy | 平均间隔: ${avg_interval}s"
        log "   已耗时: $((elapsed_time / 60))分$((elapsed_time % 60))秒 | 预计剩余: $(((TOTAL_CALLS - current_call) * CALL_INTERVAL / 60))分钟"
        log "   ─────────────────────────────────────────────────"
    fi

    # 等待到下一次调用
    if [ $current_call -lt $TOTAL_CALLS ]; then
        sleep $CALL_INTERVAL
    fi
done

# 测试完成统计
end_time=$(date +%s)
total_duration=$((end_time - start_time))
final_success_rate=$((success_count * 100 / current_call))
actual_avg_interval=$((total_duration / current_call))

log "======================================"
log "测试完成！"
log "总调用次数: $current_call"
log "成功次数: $success_count"
log "失败次数: $fail_count"
log "成功率: $final_success_rate%"
log "总耗时: $total_duration 秒 ($((total_duration / 3600))小时 $(((total_duration % 3600) / 60))分钟)"
log "实际平均间隔: ${actual_avg_interval}秒"
log "开始时间: $(date -d @$start_time)"
log "结束时间: $(date -d @$end_time)"
log "日志文件: $LOG_FILE"
log "结果文件: $RESULT_FILE"

# 判断是否被封禁
if [ $final_success_rate -lt 95 ]; then
    log "⚠️  警告: 成功率低于95%，可能已被封禁或遇到限流"
elif [ $fail_count -gt 0 ]; then
    log "⚠️  注意: 有失败调用，但成功率尚可"
else
    log "✅ 测试完成，成功率良好"
fi

log "======================================"