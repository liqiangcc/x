#!/bin/bash

# Batch Test Script for Stock K-line Data
# Optimized for testing multiple stocks with error handling and progress tracking

OUTPUT_FILE="batch_test_results_$(date +%Y%m%d_%H%M%S).txt"
LOG_FILE="batch_test_$(date +%Y%m%d_%H%M%S).log"
STOCK_COUNT=${1:-20}  # Default 20 stocks, can be passed as parameter
PARALLEL_JOBS=2       # Run 2 parallel jobs to speed up testing

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Stock list
get_stock_list() {
    cat << 'EOF'
1.600519|贵州茅台
0.000333|美的集团
1.000858|五粮液
0.002415|海康威视
1.601318|中国平安
0.002594|比亚迪
0.000725|京东方A
0.002230|科大讯飞
0.002352|顺丰控股
0.000065|格力电器
1.600887|伊利股份
0.000776|广发证券
1.600104|上海汽车
1.601166|兴业银行
1.600837|海通证券
1.600690|青岛海尔
1.600000|浦发银行
1.600585|海螺水泥
1.600660|福耀玻璃
1.600795|国电电力
0.000069|华侨城A
0.000157|中联重科
1.600028|中国石化
1.600029|南方航空
1.600030|中信证券
0.000895|双汇发展
1.600271|航天信息
0.000063|中兴通讯
1.600036|招商银行
0.000839|中信国安
0.000981|银亿股份
0.000625|长安汽车
EOF
}

# Test single stock
test_single_stock() {
    local stock_info="$1"
    local code="${stock_info%%|*}"
    local name="${stock_info##*|}"
    local result_file="/tmp/stock_${code//./_}.json"

    log "Testing $code $name"

    # Call API with timeout
    timeout 60 /root/x/api/call_api_with_rate_limit.sh get_kline "$code" 101 100 20250906 > "$result_file" 2>&1

    if [ $? -eq 0 ]; then
        if jq -e '.data' "$result_file" >/dev/null 2>&1; then
            local data_length=$(jq -r '.data.klines | length' "$result_file")
            local stock_name=$(jq -r '.data.name' "$result_file")
            local pre_price=$(jq -r '.data.preKPrice' "$result_file")
            local last_record=$(jq -r '.data.klines[-1]' "$result_file")

            echo "SUCCESS:$code:$name:$data_length:$stock_name:$pre_price:$last_record"
            log "SUCCESS: $code $name - $data_length records"
        else
            echo "FAILED:$code:$name:Invalid response format"
            log "FAILED: $code $name - Invalid response format"
        fi
    else
        echo "FAILED:$code:$name:API call failed or timeout"
        log "FAILED: $code $name - API call failed or timeout"
    fi

    rm -f "$result_file"
}

# Initialize output
init_output() {
    {
        echo "Batch Stock K-line Test Results"
        echo "================================"
        echo "Test Date: $(date)"
        echo "Target Stocks: $STOCK_COUNT"
        echo "Parallel Jobs: $PARALLEL_JOBS"
        echo "API Date: 20250906"
        echo "================================"
        echo ""
    } > "$OUTPUT_FILE"
}

# Process results
process_results() {
    local success_count=0
    local fail_count=0
    local total_records=0

    {
        echo "Detailed Results:"
        echo "----------------"
    } >> "$OUTPUT_FILE"

    while IFS=':' read -r status code name data_length stock_name pre_price last_record; do
        if [ "$status" = "SUCCESS" ]; then
            success_count=$((success_count + 1))
            total_records=$((total_records + data_length))

            echo "✅ $code $name - $data_length records" >> "$OUTPUT_FILE"
            echo "   Stock: $stock_name" >> "$OUTPUT_FILE"
            echo "   Previous Close: $pre_price" >> "$OUTPUT_FILE"
            echo "   Latest Record: $last_record" >> "$OUTPUT_FILE"
        else
            fail_count=$((fail_count + 1))
            echo "❌ $code $name - $data_length" >> "$OUTPUT_FILE"
        fi
        echo "" >> "$OUTPUT_FILE"
    done

    # Summary
    local success_rate=0
    if [ $((success_count + fail_count)) -gt 0 ]; then
        success_rate=$(( (success_count * 100) / (success_count + fail_count) ))
    fi

    {
        echo "Summary:"
        echo "--------"
        echo "Total Stocks Tested: $((success_count + fail_count))"
        echo "Successful: $success_count"
        echo "Failed: $fail_count"
        echo "Success Rate: $success_rate%"
        echo "Total K-line Records: $total_records"
        echo "Average Records per Stock: $(( total_records / success_count ))"
        echo ""
        echo "Test Completed: $(date)"
        echo "================================"
    } >> "$OUTPUT_FILE"

    log "Batch test completed: $success_count successful, $fail_count failed, $success_rate% success rate"
}

# Main function
main() {
    log "Starting batch test for $STOCK_COUNT stocks..."

    # Initialize output
    init_output

    # Get stock list
    local stocks=()
    while IFS='|' read -r code name; do
        if [ -n "$code" ] && [ -n "$name" ]; then
            stocks+=("$code|$name")
        fi
    done < <(get_stock_list)

    # Limit to requested number of stocks
    if [ ${#stocks[@]} -gt $STOCK_COUNT ]; then
        stocks=("${stocks[@]:0:$STOCK_COUNT}")
    fi

    log "Testing ${#stocks[@]} stocks with $PARALLEL_JOBS parallel jobs..."

    # Test stocks in parallel
    local pids=()
    local results=()
    local temp_files=()

    for stock_info in "${stocks[@]}"; do
        # Create temp file for this stock's result
        local temp_file=$(mktemp)
        temp_files+=("$temp_file")

        # Start background job
        test_single_stock "$stock_info" > "$temp_file" &
        pids+=($!)

        # Control parallelism
        if [ ${#pids[@]} -ge $PARALLEL_JOBS ]; then
            # Wait for first batch to complete
            for i in "${!pids[@]}"; do
                wait "${pids[i]}"
                if [ -f "${temp_files[i]}" ]; then
                    results+=("$(cat "${temp_files[i]}")")
                    rm -f "${temp_files[i]}"
                fi
            done
            pids=()
            temp_files=()
        fi
    done

    # Wait for remaining jobs
    for pid in "${pids[@]}"; do
        wait "$pid"
    done

    # Collect remaining results
    for temp_file in "${temp_files[@]}"; do
        if [ -f "$temp_file" ]; then
            results+=("$(cat "$temp_file")")
            rm -f "$temp_file"
        fi
    done

    # Process all results
    printf '%s\n' "${results[@]}" | process_results

    log "Batch test completed. Results saved to: $OUTPUT_FILE"
    echo "Results saved to: $OUTPUT_FILE"
    echo "Log file: $LOG_FILE"
}

# Usage
usage() {
    echo "Usage: $0 [stock_count]"
    echo ""
    echo "Examples:"
    echo "  $0           # Test 20 stocks (default)"
    echo "  $0 10        # Test 10 stocks"
    echo "  $0 50        # Test 50 stocks"
}

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
    exit 0
fi

# Run main function
main "$@"