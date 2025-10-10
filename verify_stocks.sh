#!/bin/bash

# 验证之前测试的股票现在是否都能正常获取数据

echo "=== 验证股票数据获取状态 ==="
echo "测试时间: $(date)"
echo "=============================="

stocks=(
    "1.600519:贵州茅台"
    "0.000333:美的集团"
    "1.000858:五粮液"
    "0.002415:海康威视"
    "1.601318:中国平安"
    "0.002594:比亚迪"
    "0.000725:京东方A"
    "0.002230:科大讯飞"
    "0.002352:顺丰控股"
    "0.000065:格力电器"
)

success_count=0
total_count=${#stocks[@]}

for stock_info in "${stocks[@]}"; do
    code="${stock_info%%:*}"
    name="${stock_info##*:}"

    echo -n "测试 $code $name... "

    # 调用API并获取结果
    result=$(/root/x/api/call_api_with_rate_limit.sh get_kline "$code" 101 100 20250906 2>/dev/null)

    if [ $? -eq 0 ]; then
        if echo "$result" | jq -e '.data' >/dev/null 2>&1; then
            record_count=$(echo "$result" | jq -r '.data.klines | length')
            stock_name=$(echo "$result" | jq -r '.data.name')
            echo "✅ 成功 ($record_count 条记录)"
            success_count=$((success_count + 1))
        else
            echo "❌ 数据格式错误"
        fi
    else
        echo "❌ API调用失败"
    fi
done

echo "=============================="
echo "验证结果: $success_count/$total_count 个股票成功"
echo "成功率: $(( (success_count * 100) / total_count ))%"
echo "验证时间: $(date)"