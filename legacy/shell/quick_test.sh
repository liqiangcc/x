#!/bin/bash

# Quick Test Script - Test a few stocks rapidly
OUTPUT_FILE="quick_test_results.txt"

log() {
    echo "[$(date '+%H:%M:%S')] $1" | tee -a "$OUTPUT_FILE"
}

{
    echo "Quick Stock K-line Test"
    echo "========================"
    echo "Start time: $(date)"
    echo ""
} > "$OUTPUT_FILE"

# Test stocks
stocks=(
    "1.600519:贵州茅台"
    "0.000333:美的集团"
    "1.000858:五粮液"
    "0.002415:海康威视"
    "1.601318:中国平安"
)

for stock_info in "${stocks[@]}"; do
    code="${stock_info%%:*}"
    name="${stock_info##*:}"

    log "Testing $code $name"
    echo "Testing $code $name" >> "$OUTPUT_FILE"

    # Call API with timeout
    timeout 30 /root/x/api/call_api_with_rate_limit.sh get_kline "$code" 101 100 20250906 > /tmp/api_response.json 2>&1

    if [ $? -eq 0 ]; then
        if jq -e '.data' /tmp/api_response.json >/dev/null 2>&1; then
            data_length=$(jq -r '.data.klines | length' /tmp/api_response.json)
            stock_name=$(jq -r '.data.name' /tmp/api_response.json)
            log "SUCCESS: $stock_name, $data_length records"
            echo "SUCCESS: $stock_name, $data_length records" >> "$OUTPUT_FILE"
            echo "First record: $(jq -r '.data.klines[0]' /tmp/api_response.json)" >> "$OUTPUT_FILE"
        else
            log "FAILED: Invalid response format"
            echo "FAILED: Invalid response format" >> "$OUTPUT_FILE"
            cat /tmp/api_response.json >> "$OUTPUT_FILE"
        fi
    else
        log "FAILED: API call timeout or error"
        echo "FAILED: API call timeout or error" >> "$OUTPUT_FILE"
        cat /tmp/api_response.json >> "$OUTPUT_FILE"
    fi

    echo "" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
done

{
    echo "========================"
    echo "End time: $(date)"
} >> "$OUTPUT_FILE"

log "Quick test completed. Results saved to $OUTPUT_FILE"