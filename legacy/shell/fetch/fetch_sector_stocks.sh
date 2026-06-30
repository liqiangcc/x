#!/bin/bash

# This script fetches all pages of stock data for a given sector from eastmoney.com.
# It requires 'jq' to be installed for JSON processing.

# Check if a sector code is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <sector_code>"
    echo "Example: $0 BK1033"
    exit 1
fi

SECTOR_CODE=$1
PAGE_SIZE=50
OUTPUT_FILE="${SECTOR_CODE}_stocks.json"

# Function to fetch a page of data
fetch_page() {
    local page_num=$1
    local sector_code=$2
    # This is the curl command from your prompt, with page number and sector code parameterized.
    curl -s "https://push2delay.eastmoney.com/api/qt/clist/get?cb=cb&fid=f62&po=1&pz=${PAGE_SIZE}&pn=${page_num}&np=1&fltt=2&invt=2&ut=8dec03ba335b81bf4ebdf7b29ec27d15&fs=b%3A${sector_code}&fields=f12%2Cf14%2Cf2%2Cf3%2Cf62%2Cf184%2Cf66%2Cf69%2Cf72%2Cf75%2Cf78%2Cf81%2Cf84%2Cf87%2Cf204%2Cf205%2Cf124%2Cf1%2Cf13" -H 'Accept: */*' -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6' -H 'Connection: keep-alive' -b 'qgqp_b_id=bee62a3dca820a540128aba84b96b45b; websitepoptg_api_time=1757126963930; st_si=16178496205567; st_nvi=eHqefbVzy2aabj4tYan4-83d2; nid=06dba78ae1511dc9000f266fd90cc84b; nid_create_time=1757126968527; gvi=4jwQT_ajFjiglUbfS-1TTcb66; gvi_create_time=1757126968527; fullscreengg=1; fullscreengg2=1; st_asi=delete; st_pvi=76408780582403; st_sp=2024-12-08%2016%3A31%3A50; st_inirUrl=https%3A%2F%2Fcn.bing.com%2F; st_sn=9; st_psi=20250906111925405-113300300992-6326433980' -H "Referer: https://data.eastmoney.com/bkzj/${sector_code}.html" -H 'Sec-Fetch-Dest: script' -H 'Sec-Fetch-Mode: no-cors' -H 'Sec-Fetch-Site: same-site' -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
}

# 1. Fetch first page to get total count
echo "Fetching page 1 for sector ${SECTOR_CODE} to get total count..."
response=$(fetch_page 1 ${SECTOR_CODE})

# 2. Extract JSON from JSONP
json_data=$(echo "$response" | sed 's/^cb(//;s/);$//')

# 3. Get total count and calculate number of pages
total=$(echo "$json_data" | jq '.data.total')
if [ -z "$total" ] || [ "$total" == "null" ]; then
    echo "Error: Could not retrieve total count for sector ${SECTOR_CODE}."
    echo "Response was: ${response}"
    exit 1
fi
num_pages=$(( (total + PAGE_SIZE - 1) / PAGE_SIZE ))

echo "Total records: $total. Fetching $num_pages pages..."

# 4. Fetch all pages and combine data
all_data_items="[]"
for i in $(seq 1 $num_pages); do
    echo "Fetching page $i..."
    response=$(fetch_page $i ${SECTOR_CODE})
    json_data=$(echo "$response" | sed 's/^cb(//;s/);$//')
    items=$(echo "$json_data" | jq '.data.diff')
    all_data_items=$(echo "$all_data_items" | jq --argjson new_items "$items" '. + $new_items')
done

# 5. Save to file
echo "$all_data_items" | jq '.' > "$OUTPUT_FILE"

echo "All data for sector ${SECTOR_CODE} saved to ${OUTPUT_FILE}"