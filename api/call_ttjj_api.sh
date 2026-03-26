#!/bin/bash

#
# API Abstraction Layer Script
#
# This script acts as a high-level wrapper for the Eastmoney/Tiantian Fund APIs.
# Its single responsibility is to know how to fetch specific resources from the API.
# It abstracts away the implementation details (like API endpoints, parameters, and headers)
# and provides a clean, command-based interface for other scripts to use.
# It always returns clean, valid JSON, ready for processing by tools like jq.

# --- Verbose mode ---
VERBOSE=false
if [ "$1" = "-v" ]; then
    VERBOSE=true
    shift
fi

# --- Logging function ---
log() {
    if [ "$VERBOSE" = true ]; then
        echo "$1" >&2
    fi
}

# --- Usage function ---
# Prints a user-friendly guide on how to use the script.
print_usage() {
    echo "Usage:" >&2
    echo "  $0 [-v] get_sectors <page_number>" >&2
    echo "  $0 [-v] get_stocks <sector_code> [page_number]" >&2
    echo "  $0 [-v] get_kline <secid> <klt> <lmt> <end_date>" >&2
    echo "  $0 [-v] get_sector_stocks" >&2
    echo "  $0 [-v] get_etfs" >&2
    echo "  $0 [-v] get_etf_details <etf_code>" >&2
    echo >&2
    echo "Options:" >&2
    echo "  -v    Verbose mode (shows progress logs)" >&2
    echo >&2
    echo "Examples:" >&2
    echo "  # Get the first page of all sectors" >&2
    echo "  $0 get_sectors 1" >&2
    echo >&2
    echo "  # Get the first page of stocks in the 'BK0433' sector" >&2
    echo "  $0 get_stocks BK0433 1" >&2
    echo "  # Get ALL stocks in the 'BK0433' sector (with automatic pagination)" >&2
    echo "  $0 get_stocks BK0433" >&2
    echo "  # Get ALL stocks with verbose output" >&2
    echo "  $0 -v get_stocks BK0433" >&2
    echo >&2
    echo "  # Get k-line data for a stock" >&2
    echo "  $0 get_kline 1.600519 101 100 20250906" >&2
    echo >&2
    echo "  # Get k-line data for a sector" >&2
    echo "  $0 get_kline 90.BK0433 101 100 20250906" >&2
    echo >&2
    echo "  # Get all stocks from all sectors" >&2
    echo "  $0 get_sector_stocks" >&2
    echo >&2
    echo "  # Get all ETFs" >&2
    echo "  $0 get_etfs" >&2
    echo >&2
    echo "  # Get details for a specific ETF" >&2
    echo "  $0 get_etf_details 520510" >&2
    echo >&2
    echo "Parameter details for get_kline:" >&2
    echo "  <secid>:    Full security code in '<market_id>.<stock_code>' format. Works for stocks, sectors, and indices." >&2
    echo "              - Market ID '1' is for Shanghai (SH)." >&2
    echo "              - Market ID '0' is for Shenzhen (SZ)." >&2
    echo "              - Market ID '116' is for Hong Kong (HKEX)." >&2
    echo "              - Market ID '90' is for Sectors/Blocks." >&2
    echo "              - Example (Stock): 1.600519" >&2
    echo "              - Example (Sector): 90.BK0433" >&2
    echo "              - Example (Index): 0.000001" >&2
    echo "              Note: Higher-level scripts can help construct the correct secid." >&2
    echo "  <klt>:      Kline type (1: 1m, 5: 5m, 15: 15m, 30: 30m, 60: 60m, 101: daily, 102: weekly, 103: monthly, 104: quarterly, 105: half-yearly, 106: yearly)" >&2
    echo "  <lmt>:      Number of data points to retrieve" >&2
    echo "  <end_date>: End date in YYYYMMDD format (e.g., 20250906)" >&2
}

# --- Command parsing ---
COMMAND=$1

# Check if a command was provided.
if [ -z "$COMMAND" ]; then
    echo "Error: No command provided." >&2
    print_usage
    exit 1
fi

shift # Consume the command argument so the rest of the arguments are available.

# --- API Logic ---
# This case statement determines which API to call based on the command.
case "$COMMAND" in
    # Handles fetching the list of all industry sectors.
    get_sectors)
        PAGE_NUM=$1
        PAGE_SIZE=100
        FIELDS="f12%2Cf13%2Cf14%2Cf1%2Cf2%2Cf4%2Cf3%2Cf152%2Cf20%2Cf8%2Cf104%2Cf105%2Cf128%2Cf140%2Cf141%2Cf207%2Cf208%2Cf209%2Cf136%2Cf222"

        # If no page number provided, fetch all pages
        if [ -z "$PAGE_NUM" ]; then
            log "Fetching all sectors..."
            FIRST_RESPONSE=true
            COMBINED_DIFF="[]"

            # Start with page 1
            CURRENT_PAGE=1
            while true; do
                log "Fetching page $CURRENT_PAGE..."

                URL="http://push2.eastmoney.com/api/qt/clist/get?np=1&fltt=1&invt=2&cb=cb&fs=m%3A90%2Bt%3A2%2Bf%3A%2150&po=1&ut=fa5fd1943c7b386f172d6893dbfba10b&fields=${FIELDS}&pn=${CURRENT_PAGE}&pz=${PAGE_SIZE}"
                REFERER="http://quote.eastmoney.com/center/gridlist.html"

                # Execute the curl command
                RAW_RESPONSE=$(curl -s "$URL" -H 'Accept: */*' -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6' -H 'Connection: keep-alive' -b 'qgqp_b_id=bee62a3dca820a540128aba84b96b45b; websitepoptg_api_time=1757126963930; st_si=16178496205567; st_nvi=eHqefbVzy2aabj4tYan4-83d2; nid=06dba78ae1511dc9000f266fd90cc84b; nid_create_time=1757126968527; gvi=4jwQT_ajFjiglUbfS-1TTcb66; gvi_create_time=1757126968527; fullscreengg=1; fullscreengg2=1; st_asi=delete; st_pvi=76408780582403; st_sp=2024-12-08%2016%3A31%3A50; st_inirUrl=https%3A%2F%2Fcn.bing.com%2F; st_sn=9; st_psi=20250906111925405-113300300992-6326433980' -H "Referer: ${REFERER}" -H 'Sec-Fetch-Dest: script' -H 'Sec-Fetch-Mode: no-cors' -H 'Sec-Fetch-Site: same-site' -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0')

                # Process response
                if [[ "$RAW_RESPONSE" == cb\(* ]]; then
                    RESPONSE=$(echo "$RAW_RESPONSE" | sed 's/^cb(//;s/);$//')
                elif echo "$RAW_RESPONSE" | jq -e '.data' >/dev/null 2>&1; then
                    RESPONSE="$RAW_RESPONSE"
                else
                    echo "Error: Invalid API response format" >&2
                    exit 1
                fi

                # Store first response structure
                if [ "$FIRST_RESPONSE" = true ]; then
                    FIRST_RESPONSE=false
                    BASE_RESPONSE="$RESPONSE"
                    COMBINED_DIFF=$(echo "$RESPONSE" | jq '.data.diff')
                else
                    # Combine diffs
                    CURRENT_DIFF=$(echo "$RESPONSE" | jq '.data.diff')
                    COMBINED_DIFF=$(echo "$COMBINED_DIFF" | jq --argjson current "$CURRENT_DIFF" '. + $current')
                fi

                # Get total count from the response
                TOTAL_COUNT=$(echo "$RESPONSE" | jq -r '.data.total // 0')
                CURRENT_COUNT=$(echo "$COMBINED_DIFF" | jq 'length')

                log "Fetched $CURRENT_COUNT of $TOTAL_COUNT total sectors"

                # Check if we've got all sectors
                if [ "$CURRENT_COUNT" -ge "$TOTAL_COUNT" ] && [ "$TOTAL_COUNT" -gt 0 ]; then
                    log "All sectors fetched successfully!"
                    break
                fi

                # Check if current page is empty
                PAGE_DIFF_COUNT=$(echo "$RESPONSE" | jq '.data.diff | length')
                if [ "$PAGE_DIFF_COUNT" -eq 0 ]; then
                    log "No more sectors found. Stopping."
                    break
                fi

                # Move to next page
                CURRENT_PAGE=$((CURRENT_PAGE + 1))

                # Wait 20 seconds before next API call (except for the first page)
                if [ "$CURRENT_PAGE" -gt 1 ]; then
                    log "Waiting 20 seconds before next request..."
                    sleep 20
                fi
            done

            # Return combined result with original structure
            echo "$BASE_RESPONSE" | jq --argjson combined_diff "$COMBINED_DIFF" \
                '.data.diff = $combined_diff | .data.total = ($combined_diff | length)'
            exit 0
        else
            # Single page request
            URL="https://push2.eastmoney.com/api/qt/clist/get?np=1&fltt=1&invt=2&cb=cb&fs=m%3A90%2Bt%3A2%2Bf%3A%2150&po=1&ut=fa5fd1943c7b386f172d6893dbfba10b&fields=${FIELDS}&pn=${PAGE_NUM}&pz=${PAGE_SIZE}"
            REFERER="https://quote.eastmoney.com/center/gridlist.html"
        fi
        ;;
    # Handles fetching the list of all stocks within a specific sector.
    get_stocks)
        SECTOR_CODE=$1
        PAGE_NUM=$2
        PAGE_SIZE=100
        FIELDS="f12%2Cf14%2Cf2%2Cf3%2Cf62%2Cf184%2Cf66%2Cf69%2Cf72%2Cf75%2Cf78%2Cf81%2Cf84%2Cf87%2Cf204%2Cf205%2Cf124%2Cf1%2Cf13"

        # If no page number provided, fetch all pages
        if [ -z "$PAGE_NUM" ]; then
            log "Fetching all stocks for sector $SECTOR_CODE..."
            FIRST_RESPONSE=true
            COMBINED_DIFF="[]"

            # Start with page 1
            CURRENT_PAGE=1
            while true; do
                log "Fetching page $CURRENT_PAGE..."

                URL="https://push2delay.eastmoney.com/api/qt/clist/get?cb=cb&fid=f62&po=1&np=1&fltt=2&invt=2&ut=8dec03ba335b81bf4ebdf7b29ec27d15&fs=b%3A${SECTOR_CODE}&fields=${FIELDS}&pn=${CURRENT_PAGE}&pz=${PAGE_SIZE}"
                REFERER="https://data.eastmoney.com/bkzj/${SECTOR_CODE}.html"

                # Execute the curl command
                RAW_RESPONSE=$(curl -s "$URL" -H 'Accept: */*' -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6' -H 'Connection: keep-alive' -b 'qgqp_b_id=bee62a3dca820a540128aba84b96b45b; websitepoptg_api_time=1757126963930; st_si=16178496205567; st_nvi=eHqefbVzy2aabj4tYan4-83d2; nid=06dba78ae1511dc9000f266fd90cc84b; nid_create_time=1757126968527; gvi=4jwQT_ajFjiglUbfS-1TTcb66; gvi_create_time=1757126968527; fullscreengg=1; fullscreengg2=1; st_asi=delete; st_pvi=76408780582403; st_sp=2024-12-08%2016%3A31%3A50; st_inirUrl=https%3A%2F%2Fcn.bing.com%2F; st_sn=9; st_psi=20250906111925405-113300300992-6326433980' -H "Referer: ${REFERER}" -H 'Sec-Fetch-Dest: script' -H 'Sec-Fetch-Mode: no-cors' -H 'Sec-Fetch-Site: same-site' -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0')

                # Process response
                if [[ "$RAW_RESPONSE" == cb\(* ]]; then
                    RESPONSE=$(echo "$RAW_RESPONSE" | sed 's/^cb(//;s/);$//')
                elif echo "$RAW_RESPONSE" | jq -e '.data' >/dev/null 2>&1; then
                    RESPONSE="$RAW_RESPONSE"
                else
                    echo "Error: Invalid API response format" >&2
                    exit 1
                fi

                # Store first response structure
                if [ "$FIRST_RESPONSE" = true ]; then
                    FIRST_RESPONSE=false
                    BASE_RESPONSE="$RESPONSE"
                    COMBINED_DIFF=$(echo "$RESPONSE" | jq '.data.diff')
                else
                    # Combine diffs
                    CURRENT_DIFF=$(echo "$RESPONSE" | jq '.data.diff')
                    COMBINED_DIFF=$(echo "$COMBINED_DIFF" | jq --argjson current "$CURRENT_DIFF" '. + $current')
                fi

                # Get total count from the response
                TOTAL_COUNT=$(echo "$RESPONSE" | jq -r '.data.total // 0')
                CURRENT_COUNT=$(echo "$COMBINED_DIFF" | jq 'length')

                log "Fetched $CURRENT_COUNT of $TOTAL_COUNT total stocks"

                # Check if we've got all stocks
                if [ "$CURRENT_COUNT" -ge "$TOTAL_COUNT" ] && [ "$TOTAL_COUNT" -gt 0 ]; then
                    log "All stocks fetched successfully!"
                    break
                fi

                # Check if current page is empty
                PAGE_DIFF_COUNT=$(echo "$RESPONSE" | jq '.data.diff | length')
                if [ "$PAGE_DIFF_COUNT" -eq 0 ]; then
                    log "No more stocks found. Stopping."
                    break
                fi

                # Move to next page
                CURRENT_PAGE=$((CURRENT_PAGE + 1))

                # Wait 20 seconds before next API call (except for the first page)
                if [ "$CURRENT_PAGE" -gt 1 ]; then
                    log "Waiting 20 seconds before next request..."
                    sleep 20
                fi
            done

            # Return combined result with original structure
            echo "$BASE_RESPONSE" | jq --argjson combined_diff "$COMBINED_DIFF" \
                '.data.diff = $combined_diff | .data.total = ($combined_diff | length)'
            exit 0
        else
            # Single page request
            URL="https://push2delay.eastmoney.com/api/qt/clist/get?cb=cb&fid=f62&po=1&np=1&fltt=2&invt=2&ut=8dec03ba335b81bf4ebdf7b29ec27d15&fs=b%3A${SECTOR_CODE}&fields=${FIELDS}&pn=${PAGE_NUM}&pz=${PAGE_SIZE}"
            REFERER="https://data.eastmoney.com/bkzj/${SECTOR_CODE}.html"
        fi
        ;;
    # Handles fetching all stocks from all sectors.
    get_sector_stocks)
        log "Fetching all sectors first..."
        # Get all sectors (using existing logic)
        SECTORS_RESPONSE=$(bash "$0" get_sectors)
        if [ $? -ne 0 ]; then
            echo "Error: Failed to fetch sectors" >&2
            exit 1
        fi

        # Extract sector codes
        SECTOR_CODES=$(echo "$SECTORS_RESPONSE" | jq -r '.data.diff[].f12')

        if [ -z "$SECTOR_CODES" ]; then
            echo "Error: No sectors found" >&2
            exit 1
        fi

        log "Found $(echo "$SECTOR_CODES" | wc -l) sectors"

        # Initialize combined result
        FIRST_RESPONSE=true
        COMBINED_DIFF="[]"

        # Process each sector
        for SECTOR_CODE in $SECTOR_CODES; do
            log "Fetching stocks for sector $SECTOR_CODE..."

            # Get stocks for this sector (using existing logic with pagination)
            SECTOR_RESPONSE=$(bash "$0" get_stocks "$SECTOR_CODE")
            if [ $? -eq 0 ]; then
                # Extract the diff array from this sector's response
                SECTOR_DIFF=$(echo "$SECTOR_RESPONSE" | jq '.data.diff')

                if [ "$FIRST_RESPONSE" = true ]; then
                    FIRST_RESPONSE=false
                    BASE_RESPONSE="$SECTOR_RESPONSE"
                    COMBINED_DIFF="$SECTOR_DIFF"
                else
                    # Combine diffs
                    COMBINED_DIFF=$(echo "$COMBINED_DIFF" | jq --argjson sector_diff "$SECTOR_DIFF" '. + $sector_diff')
                fi

                SECTOR_COUNT=$(echo "$SECTOR_DIFF" | jq 'length')
                TOTAL_COUNT=$(echo "$COMBINED_DIFF" | jq 'length')
                log "Added $SECTOR_COUNT stocks from sector $SECTOR_CODE (total: $TOTAL_COUNT)"
            else
                log "Warning: Failed to fetch stocks for sector $SECTOR_CODE"
            fi

            # Wait a bit between sectors to avoid rate limiting
            sleep 2
        done

        # Create a simplified response with basic structure and count
        TOTAL_COUNT=$(echo "$COMBINED_DIFF" | jq 'length')
        echo "$BASE_RESPONSE" | jq --arg total_count "$TOTAL_COUNT"             '.data.diff = [] | .data.total = ($total_count | tonumber) | .data.diff = '"$COMBINED_DIFF"
        exit 0
        ;;
    # Handles fetching all ETFs.
    get_etfs)
        log "Fetching all ETFs..."
        PAGE_SIZE=5000 # Set a large page size as this endpoint supports it
        FIRST_RESPONSE=true
        COMBINED_DATA="[]"

        # Start with page 1
        CURRENT_PAGE=1
        while true; do
            log "Fetching page $CURRENT_PAGE..."

            URL="https://datacenter.eastmoney.com/stock/fundselector/api/data/get?type=RPTA_APP_FUNDSELECT&sty=ETF_TYPE_CODE,SECUCODE,SECURITY_CODE,CHANGE_RATE_1W,CHANGE_RATE_1M,CHANGE_RATE_3M,YTD_CHANGE_RATE,DEC_TOTALSHARE,DEC_NAV,SECURITY_NAME_ABBR,DERIVE_INDEX_CODE,INDEX_CODE,INDEX_NAME,NEW_PRICE,CHANGE_RATE,CHANGE,VOLUME,DEAL_AMOUNT,PREMIUM_DISCOUNT_RATIO,QUANTITY_RELATIVE_RATIO,HIGH_PRICE,LOW_PRICE,STOCK_ID,PRE_CLOSE_PRICE&source=FUND_SELECTOR&client=APP&sr=-1,-1,1&st=CHANGE_RATE,CHANGE,SECURITY_CODE&filter=(ETF_TYPE_CODE%3D%22ALL%22)&p=${CURRENT_PAGE}&ps=${PAGE_SIZE}"
            REFERER="https://fund.eastmoney.com/"

            # Execute the curl command
            RAW_RESPONSE=$(curl -s "$URL" -H 'Accept: */*' -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6' -H 'Connection: keep-alive' -H "Referer: ${REFERER}" -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0')

            # Process response
            if echo "$RAW_RESPONSE" | jq -e '.result.data' >/dev/null 2>&1; then
                RESPONSE="$RAW_RESPONSE"
            else
                echo "Error: Invalid API response format for get_etfs" >&2
                echo "Response: $RAW_RESPONSE" >&2
                exit 1
            fi

            # Store first response structure
            if [ "$FIRST_RESPONSE" = true ]; then
                FIRST_RESPONSE=false
                BASE_RESPONSE="$RESPONSE"
                COMBINED_DATA=$(echo "$RESPONSE" | jq '.result.data')
            else
                # Combine data
                CURRENT_DATA=$(echo "$RESPONSE" | jq '.result.data')
                COMBINED_DATA=$(echo "$COMBINED_DATA" | jq --argjson current "$CURRENT_DATA" '. + $current')
            fi

            # Get total pages from the response
            TOTAL_PAGES=$(echo "$RESPONSE" | jq -r '.result.pages // 0')
            CURRENT_COUNT=$(echo "$COMBINED_DATA" | jq 'length')

            log "Fetched page $CURRENT_PAGE of $TOTAL_PAGES. Total ETFs so far: $CURRENT_COUNT"

            # Check if we've got all pages
            if [ "$CURRENT_PAGE" -ge "$TOTAL_PAGES" ] && [ "$TOTAL_PAGES" -gt 0 ]; then
                log "All ETFs fetched successfully!"
                break
            fi

            # Check if current page is empty or if there are no pages
            PAGE_DATA_COUNT=$(echo "$RESPONSE" | jq '.result.data | length')
            if [ "$PAGE_DATA_COUNT" -eq 0 ] || [ "$TOTAL_PAGES" -eq 0 ]; then
                log "No more ETFs found. Stopping."
                break
            fi

            # Move to next page
            CURRENT_PAGE=$((CURRENT_PAGE + 1))

            # Wait before next API call
            log "Waiting 2 seconds before next request..."
            sleep 2
        done

        # Return combined result with original structure
        # Manually construct the JSON to avoid "Argument list too long" error with jq
        echo "{\"result\":{\"data\":${COMBINED_DATA}, \"count\":$(echo "$COMBINED_DATA" | jq 'length')}}"
        exit 0
        ;;
    get_etf_details)
        ETF_CODE=$1
        if [ -z "$ETF_CODE" ]; then
            echo "Error: ETF code is required for get_etf_details" >&2
            print_usage
            exit 1
        fi
        log "Fetching details for ETF $ETF_CODE using python script..."
        
        # Get the directory of the current script
        SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
        
        python3 "$SCRIPT_DIR/parse_etf_details.py" "$ETF_CODE"
        
        exit 0
        ;;
    # Handles fetching k-line data for a stock.
    get_kline)
        SECID=$1
        KLT=$2
        LMT=$3
        END=$4
        LOC=1738771200000
        URL="https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${SECID}&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${KLT}&fqt=1&end=${END}&lmt=${LMT}&_=${LOC}"
        REFERER="https://quote.eastmoney.com/"
        ;;
    # Handles unknown commands.
    *)
        echo "Error: Unknown command: $COMMAND" >&2
        print_usage
        exit 1
        ;;
esac

# Execute the curl command with all the necessary headers and options.
# The -s flag is used to ensure that only the response body is printed to stdout.
RAW_RESPONSE=$(curl -s "$URL" -H 'Accept: */*' -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6' -H 'Connection: keep-alive' -b 'qgqp_b_id=bee62a3dca820a540128aba84b96b45b; websitepoptg_api_time=1757126963930; st_si=16178496205567; st_nvi=eHqefbVzy2aabj4tYan4-83d2; nid=06dba78ae1511dc9000f266fd90cc84b; nid_create_time=1757126968527; gvi=4jwQT_ajFjiglUbfS-1TTcb66; gvi_create_time=1757126968527; fullscreengg=1; fullscreengg2=1; st_asi=delete; st_pvi=76408780582403; st_sp=2024-12-08%2016%3A31%3A50; st_inirUrl=https%3A%2F%2Fcn.bing.com%2F; st_sn=9; st_psi=20250906111925405-113300300992-6326433980' -H "Referer: ${REFERER}" -H 'Sec-Fetch-Dest: script' -H 'Sec-Fetch-Mode: no-cors' -H 'Sec-Fetch-Site: same-site' -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0')

# Check if the response is valid
if [[ -n "$RAW_RESPONSE" ]]; then
    # Check if it's a JSONP response (starts with "cb(")
    if [[ "$RAW_RESPONSE" == cb\(* ]]; then
        # The API returns a JSONP response (e.g., cb({...})).
        # This strips the callback wrapper to return clean, valid JSON.
        echo "$RAW_RESPONSE" | sed 's/^cb(//;s/);$//'
        exit 0
    # Check if it's a direct JSON response (contains "data" field)
    elif echo "$RAW_RESPONSE" | jq -e '.data' >/dev/null 2>&1; then
        # Direct JSON response, return as-is
        echo "$RAW_RESPONSE"
        exit 0
    else
        echo "Error: Invalid API response format for command '$COMMAND'" >&2
        echo "Response: $RAW_RESPONSE" >&2
        exit 1
    fi
else
    echo "Error: Empty API response for command '$COMMAND'" >&2
    exit 1
fi
