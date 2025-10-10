#!/bin/bash

# Stock Kline Data Testing Script
# Fetches K-line data for 100 stocks and saves results to file for debugging

# Configuration
OUTPUT_FILE="stock_kline_test_results.txt"
STOCK_COUNT=100
MAX_RETRIES=3
RETRY_DELAY=5
LOG_FILE="stock_kline_test.log"

# Test date (can be adjusted)
TEST_DATE="20250906"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Get stock list (some popular Chinese stocks)
get_stock_list() {
    cat << 'EOF'
1.600519  # 贵州茅台
1.000858  # 五粮液
0.002415  # 海康威视
0.000333  # 美的集团
0.000063  # 中兴通讯
1.600036  # 招商银行
0.002594  # 比亚迪
0.000725  # 京东方A
1.601318  # 中国平安
0.000066  # 长城电脑
0.002230  # 科大讯飞
0.000858  # 五粮液
1.600271  # 航天信息
0.002352  # 顺丰控股
0.000065  # 格力电器
0.000895  # 双汇发展
1.600887  # 伊利股份
0.000776  # 广发证券
1.600104  # 上海汽车
0.002439  # 招商地产
0.000858  # 五粮液
1.600519  # 贵州茅台
0.002415  # 海康威视
0.000333  # 美的集团
0.000063  # 中兴通讯
1.600036  # 招商银行
0.002594  # 比亚迪
0.000725  # 京东方A
1.601318  # 中国平安
0.000066  # 长城电脑
0.002230  # 科大讯飞
0.000858  # 五粮液
1.600271  # 航天信息
0.002352  # 顺丰控股
0.000065  # 格力电器
0.000895  # 双汇发展
1.600887  # 伊利股份
0.000776  # 广发证券
1.600104  # 上海汽车
0.002439  # 招商地产
1.601166  # 兴业银行
0.000981  # 银亿股份
1.600837  # 海通证券
0.000625  # 长安汽车
1.600690  # 青岛海尔
0.002202  # 金风科技
1.600000  # 浦发银行
0.000839  # 中信国安
1.600585  # 海螺水泥
0.002146  # 宁波韵升
1.600016  # 民生银行
0.000932  # 华菱钢铁
1.600660  # 福耀玻璃
0.000069  # 华侨城A
1.600795  # 国电电力
0.000157  # 中联重科
1.600820  # 隧道股份
0.000568  # 泸州老窖
1.600028  # 中国石化
0.000826  # 莱宝高科
1.600029  # 南方航空
0.000990  # 诚志股份
1.600030  # 中信证券
0.000998  # 隆平高科
1.600031  # 三一重工
0.002007  # 华兰生物
1.600033  # 福建高速
0.002128  # 露天煤业
1.600036  # 招商银行
0.002146  # 宁波韵升
1.600048  # 保利地产
0.002202  # 金风科技
1.600050  # 中国联通
0.002234  # 民和股份
1.600055  # 万科A
0.002273  # 浙江医药
1.600058  # 五矿发展
0.002276  # 万马股份
1.600059  # 古越龙山
0.002288  # 超声电子
1.600060  # 海信电器
0.002293  # 光线传媒
1.600062  # 华润双鹤
0.002299  # 星网锐捷
1.600063  # 皖维高新
0.002304  # 洋河股份
1.600064  # 南京高科
0.002310  # 广东南粤
1.600066  # 宇通客车
0.002313  # 日海通讯
1.600067  # 冠城大通
0.002318  # 久其软件
1.600068  # 葛洲坝
0.002319  # 乐通股份
1.600069  # 银鸽投资
0.002323  # 中电鑫龙
1.600070  # 浙江富润
0.002326  # 永太科技
1.600071  # 凤凰光学
0.002329  # 皇氏集团
1.600072  # 中船股份
0.002332  # 仙琚制药
1.600075  * 新疆天业
0.002335  # 科华恒盛
EOF
}

# Initialize output file
init_output_file() {
    {
        echo "Stock K-line Data Test Results"
        echo "======================================"
        echo "Test Date: $(date)"
        echo "Target Stocks: $STOCK_COUNT"
        echo "API Date: $TEST_DATE"
        echo "======================================"
        echo ""
    } > "$OUTPUT_FILE"

    log "Initialized output file: $OUTPUT_FILE"
}

# Fetch K-line data for a single stock
fetch_stock_kline() {
    local stock_code="$1"
    local stock_name="$2"
    local retry_count=0

    log "Fetching data for stock: $stock_code $stock_name"

    while [ $retry_count -lt $MAX_RETRIES ]; do
        if [ $retry_count -gt 0 ]; then
            log "Retry $retry_count for stock $stock_code"
            sleep $RETRY_DELAY
        fi

        # Call API with rate limiting
        local response
        response=$(/root/x/api/call_api_with_rate_limit.sh get_kline "$stock_code" 101 100 "$TEST_DATE" 2>/dev/null)

        if [ $? -eq 0 ] && [ -n "$response" ]; then
            # Validate response contains data
            if echo "$response" | jq -e '.data' >/dev/null 2>&1; then
                local data_length=$(echo "$response" | jq -r '.data.klines | length')
                log "Successfully fetched $data_length kline records for $stock_code"
                echo "$response"
                return 0
            else
                log "Invalid response format for $stock_code"
            fi
        else
            log "API call failed for $stock_code (attempt $((retry_count + 1)))"
        fi

        retry_count=$((retry_count + 1))
    done

    log "Failed to fetch data for $stock_code after $MAX_RETRIES attempts"
    echo "ERROR: Failed to fetch data for $stock_code"
    return 1
}

# Process stocks
process_stocks() {
    local success_count=0
    local fail_count=0
    local processed_count=0

    log "Starting to process $STOCK_COUNT stocks..."

    while IFS='#' read -r stock_code stock_name; do
        # Skip empty lines and comments
        if [ -z "$stock_code" ] || [ -z "$stock_name" ]; then
            continue
        fi

        # Clean up whitespace
        stock_code=$(echo "$stock_code" | xargs)
        stock_name=$(echo "$stock_name" | xargs)

        processed_count=$((processed_count + 1))

        {
            echo "Stock #$processed_count: $stock_code $stock_name"
            echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
            echo "----------------------------------------"
        } >> "$OUTPUT_FILE"

        # Fetch kline data
        local result
        result=$(fetch_stock_kline "$stock_code" "$stock_name")

        if [ $? -eq 0 ] && [ -n "$result" ]; then
            # Check if result is valid JSON
            if echo "$result" | jq -e '.data' >/dev/null 2>&1; then
                success_count=$((success_count + 1))
                echo "Status: SUCCESS" >> "$OUTPUT_FILE"

                # Save sample data (first few lines)
                echo "Sample Data:" >> "$OUTPUT_FILE"
                echo "$result" | jq -r '.data.klines[0:2] | .[]' >> "$OUTPUT_FILE"

                # Save summary info
                local stock_name=$(echo "$result" | jq -r '.data.name')
                local stock_market=$(echo "$result" | jq -r '.data.market')
                local stock_price=$(echo "$result" | jq -r '.data.preKPrice')
                local data_length=$(echo "$result" | jq -r '.data.klines | length')

                echo "Info: Name: $stock_name, Market: $stock_market, PreClose: $stock_price" >> "$OUTPUT_FILE"
                echo "Records: $data_length" >> "$OUTPUT_FILE"
            else
                fail_count=$((fail_count + 1))
                echo "Status: FAILED" >> "$OUTPUT_FILE"
                echo "Error: Invalid JSON response" >> "$OUTPUT_FILE"
                echo "Raw Response: $result" >> "$OUTPUT_FILE"
            fi
        else
            fail_count=$((fail_count + 1))
            echo "Status: FAILED" >> "$OUTPUT_FILE"
            echo "Error: No response received" >> "$OUTPUT_FILE"
        fi

        echo "" >> "$OUTPUT_FILE"

        # Progress update
        if [ $((processed_count % 10)) -eq 0 ]; then
            log "Progress: $processed_count/$STOCK_COUNT processed (Success: $success_count, Failed: $fail_count)"
        fi

        # Stop if we've processed enough stocks
        if [ $processed_count -ge $STOCK_COUNT ]; then
            break
        fi

        # Small delay between requests to avoid overwhelming the system
        sleep 1

    done < <(get_stock_list)

    # Summary
    {
        echo "======================================"
        echo "Test Summary"
        echo "======================================"
        echo "Total Stocks Processed: $processed_count"
        echo "Successful: $success_count"
        echo "Failed: $fail_count"
        echo "Success Rate: $(( (success_count * 100) / processed_count ))%"
        echo "Test Completed: $(date)"
        echo "======================================"
    } >> "$OUTPUT_FILE"

    log "Test completed. Processed $processed_count stocks: $success_count successful, $fail_count failed"
}

# Main function
main() {
    log "Starting stock kline data test..."

    # Initialize output file
    init_output_file

    # Process stocks
    process_stocks

    log "Test completed. Results saved to: $OUTPUT_FILE"
    echo "Test completed. Results saved to: $OUTPUT_FILE"
    echo "Log file: $LOG_FILE"
}

# Usage function
usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -c COUNT    Number of stocks to test (default: $STOCK_COUNT)"
    echo "  -d DATE     Test date in YYYYMMDD format (default: $TEST_DATE)"
    echo "  -o FILE     Output file (default: $OUTPUT_FILE)"
    echo "  -h          Show this help message"
    echo ""
    echo "Example:"
    echo "  $0 -c 50 -d 20250906 -o my_test_results.txt"
}

# Parse command line arguments
while getopts "c:d:o:h" opt; do
    case $opt in
        c) STOCK_COUNT="$OPTARG" ;;
        d) TEST_DATE="$OPTARG" ;;
        o) OUTPUT_FILE="$OPTARG" ;;
        h) usage; exit 0 ;;
        \?) echo "Invalid option: -$OPTARG" >&2; usage; exit 1 ;;
    esac
done

# Validate test date format
if [[ ! "$TEST_DATE" =~ ^[0-9]{8}$ ]]; then
    echo "Error: Invalid date format. Use YYYYMMDD" >&2
    exit 1
fi

# Run main function
main "$@"