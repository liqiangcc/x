#!/bin/bash

# Simple test script for stock kline data
# This script focuses on core functionality without complex logging

OUTPUT_FILE="simple_test_results.txt"

echo "Simple Stock K-line Test" > "$OUTPUT_FILE"
echo "Test Date: $(date)" >> "$OUTPUT_FILE"
echo "========================" >> "$OUTPUT_FILE"

# Test stocks
stocks=(
    "1.600519:贵州茅台"
    "0.000333:美的集团"
    "1.000858:五粮液"
    "0.002415:海康威视"
    "1.601318:中国平安"
)

success_count=0
total_count=${#stocks[@]}

for stock_info in "${stocks[@]}"; do
    code="${stock_info%%:*}"
    name="${stock_info##*:}"

    echo "Testing $code $name..." >> "$OUTPUT_FILE"

    # Call API directly
    result=$(/root/x/api/call_api_with_rate_limit.sh get_kline "$code" 101 100 20250906 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$result" ]; then
        # Check if valid JSON
        if echo "$result" | jq -e '.data' >/dev/null 2>&1; then
            data_length=$(echo "$result" | jq -r '.data.klines | length')
            stock_name=$(echo "$result" | jq -r '.data.name')
            echo "✅ SUCCESS: $stock_name - $data_length records" >> "$OUTPUT_FILE"
            echo "   First record: $(echo "$result" | jq -r '.data.klines[0]')" >> "$OUTPUT_FILE"
            success_count=$((success_count + 1))
        else
            echo "❌ FAILED: Invalid JSON format" >> "$OUTPUT_FILE"
        fi
    else
        echo "❌ FAILED: API call failed" >> "$OUTPUT_FILE"
    fi

    echo "" >> "$OUTPUT_FILE"
done

# Summary
{
    echo "========================"
    echo "Summary"
    echo "========================"
    echo "Total Stocks: $total_count"
    echo "Successful: $success_count"
    echo "Failed: $((total_count - success_count))"
    echo "Success Rate: $(( (success_count * 100) / total_count ))%"
    echo "Test Completed: $(date)"
    echo "========================"
} >> "$OUTPUT_FILE"

echo "Test completed. Results saved to: $OUTPUT_FILE"
echo "Success rate: $(( (success_count * 100) / total_count ))%"