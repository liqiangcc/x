#!/bin/bash

# Script to fetch kline data for all stocks from database
# Usage: ./fetch_all_stocks_kline.sh [klt] [lmt] [end_date] [output_file]

DB_PATH="stocks.db"
API_SCRIPT="./api/call_ttjj_api.sh"

# Default parameters
KLT=${1:-101}      # K线类型: 101=日K
LMT=${2:-100}      # 数据点数量
END_DATE=${3:-$(date +%Y%m%d)}  # 结束日期，默认今天
OUTPUT_FILE=${4:-"stocks_kline_$(date +%Y%m%d).json"}  # 输出文件

echo "Starting to fetch kline data for all stocks..."
echo "Database: $DB_PATH"
echo "K-line type: $KLT"
echo "Data points: $LMT"
echo "End date: $END_DATE"
echo "Output file: $OUTPUT_FILE"

# 检查数据库文件是否存在
if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database file $DB_PATH not found"
    exit 1
fi

# 检查API脚本是否存在
if [ ! -f "$API_SCRIPT" ]; then
    echo "Error: API script $API_SCRIPT not found"
    exit 1
fi

# 获取股票总数
TOTAL_STOCKS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM stocks;")
echo "Total stocks to process: $TOTAL_STOCKS"

# 创建临时文件
TEMP_FILE=$(mktemp)
echo "[" > "$OUTPUT_FILE"

# 从数据库读取股票代码并处理
count=0
sqlite3 "$DB_PATH" "SELECT stock_code, market_id, stock_name FROM stocks ORDER BY stock_code;" | while IFS='|' read -r stock_code market_id stock_name; do
    count=$((count + 1))

    # 构建secid (市场ID.股票代码)
    secid="${market_id}.${stock_code}"

    echo "Processing $count/$TOTAL_STOCKS: $stock_name ($stock_code, $secid)"

    # 调用API获取K线数据
    result=$("$API_SCRIPT" get_kline "$secid" "$KLT" "$LMT" "$END_DATE")

    # 检查API调用是否成功
    if [ $? -eq 0 ] && [ -n "$result" ]; then
        # 提取数据并添加股票信息
        kline_data=$(echo "$result" | jq -r '.data.klines // empty')

        if [ -n "$kline_data" ]; then
            # 构建JSON对象
            json_object=$(cat << EOF
{
  "stock_code": "$stock_code",
  "market_id": "$market_id",
  "stock_name": "$stock_name",
  "secid": "$secid",
  "kline_type": $KLT,
  "data_points": $LMT,
  "end_date": "$END_DATE",
  "klines": $kline_data,
  "fetched_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

            # 如果不是第一条记录，添加逗号分隔符
            if [ $count -gt 1 ]; then
                echo "," >> "$OUTPUT_FILE"
            fi

            # 将JSON数据写入文件
            echo "$json_object" >> "$OUTPUT_FILE"
            echo "  ✓ Successfully fetched kline data for $stock_name"
        else
            echo "  ✗ No kline data returned for $stock_name"
        fi
    else
        echo "  ✗ Failed to fetch kline data for $stock_name"
    fi

    # 添加延时避免API频率限制
    sleep 20
done

# 完成JSON文件
echo "]" >> "$OUTPUT_FILE"

echo ""
echo "Completed! Results saved to: $OUTPUT_FILE"
echo "Total stocks processed: $count"

# 显示文件大小
if [ -f "$OUTPUT_FILE" ]; then
    file_size=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo "File size: $file_size"
fi

# 清理临时文件
rm -f "$TEMP_FILE"