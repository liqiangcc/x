#!/bin/bash

# This script fetches all pages of industry sector data from eastmoney.com.
# It requires 'jq' to be installed for JSON processing.

fetch_page() {
    local page_num=$1
    curl -s "https://push2.eastmoney.com/api/qt/clist/get?np=1&fltt=1&invt=2&cb=cb&fs=m%3A90%2Bt%3A2%2Bf%3A%2150&fields=f12%2Cf13%2Cf14%2Cf1%2Cf2%2Cf4%2Cf3%2Cf152%2Cf20%2Cf8%2Cf104%2Cf105%2Cf128%2Cf140%2Cf141%2Cf207%2Cf208%2Cf209%2Cf136%2Cf222&fid=f3&pn=${page_num}&pz=20&po=1&dect=1&ut=fa5fd1943c7b386f172d6893dbfba10b" -H 'Accept: */*' -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6' -H 'Connection: keep-alive' -b 'qgqp_b_id=bee62a3dca820a540128aba84b96b45b; websitepoptg_api_time=1757126963930; st_si=16178496205567; st_asi=delete; st_nvi=eHqefbVzy2aabj4tYan4-83d2; nid=06dba78ae1511dc9000f266fd90cc84b; nid_create_time=1757126968527; gvi=4jwQT_ajFjiglUbfS-1TTcb66; gvi_create_time=1757126968527; fullscreengg=1; fullscreengg2=1; st_pvi=76408780582403; st_sp=2024-12-08%2016%3A31%3A50; st_inirUrl=https%3A%2F%2Fcn.bing.com%2F; st_sn=4; st_psi=20250906105027472-113200301353-3855463589' -H 'Referer: https://quote.eastmoney.com/center/gridlist.html' -H 'Sec-Fetch-Dest: script' -H 'Sec-Fetch-Mode: no-cors' -H 'Sec-Fetch-Site: same-site' -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
}

# 1. Fetch first page to get total
echo "Fetching page 1 to get total count..."
response=$(fetch_page 1)

# 2. Extract JSON from JSONP
json_data=$(echo "$response" | sed 's/^cb(//;s/);$//')

# 3. Get total count
total=$(echo "$json_data" | jq '.data.total')
page_size=20
num_pages=$(( (total + page_size - 1) / page_size ))

echo "Total records: $total. Fetching $num_pages pages..."

# 4. Fetch all pages and combine data
all_data_items="[]"
for i in $(seq 1 $num_pages); do
    echo "Fetching page $i..."
    response=$(fetch_page $i)
    json_data=$(echo "$response" | sed 's/^cb(//;s/);$//')
    items=$(echo "$json_data" | jq '.data.diff')
    all_data_items=$(echo "$all_data_items" | jq --argjson new_items "$items" '. + $new_items')
done

# 5. Save to file
output_file="all_sectors.json"
echo "$all_data_items" | jq '.' > "$output_file"

echo "All data saved to $output_file"
