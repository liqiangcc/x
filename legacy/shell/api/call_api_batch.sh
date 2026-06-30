#!/bin/bash

# Batch API Call Script - Optimized for frequent calls
# This script is optimized for batch operations and frequent API calls

# Configuration
BATCH_SIZE=10          # Number of calls per batch
BATCH_DELAY=1          # Delay between batches (seconds)
CALL_DELAY=0.1         # Delay between calls in batch (seconds)

# Global proxy check - only check once per batch run
check_proxy_once() {
    if [ "$PROXY_CHECKED" != "true" ] && [ "$DISABLE_PROXY_ROTATION" != "true" ]; then
        echo "Checking proxy status once..." >&2
        if ! /root/x/proxy/proxy_manager.sh check-rotate >/dev/null 2>&1; then
            echo "Warning: Proxy check failed, continuing..." >&2
        fi
        export PROXY_CHECKED=true
    fi
}

# Single API call without proxy check
call_api_once() {
    local command=$1
    shift

    # Use the simple API script without proxy management
    /root/x/api/call_ttjj_api.sh "$command" "$@" 2>/dev/null
}

# Batch API call with delay
call_api_batch() {
    local command=$1
    shift
    local count=${1:-1}

    check_proxy_once

    echo "Processing $count API calls..." >&2

    for i in $(seq 1 $count); do
        echo "Call $i/$count..." >&2

        if response=$(call_api_once "$command" "$@"); then
            echo "$response"
        else
            echo "Error: API call failed" >&2
        fi

        # Add small delay between calls to avoid overwhelming the server
        if [ $i -lt $count ]; then
            sleep $CALL_DELAY
        fi
    done
}

# Read API calls from file
call_api_from_file() {
    local file=$1

    if [ ! -f "$file" ]; then
        echo "Error: File not found: $file" >&2
        exit 1
    fi

    check_proxy_once

    echo "Processing API calls from file: $file" >&2

    while IFS= read -r line; do
        # Skip empty lines and comments
        if [[ -n "$line" && ! "$line" =~ ^# ]]; then
            echo "Processing: $line" >&2

            if response=$(eval "/root/x/api/call_ttjj_api.sh $line" 2>/dev/null); then
                echo "$response"
            else
                echo "Error: API call failed for: $line" >&2
            fi

            sleep $CALL_DELAY
        fi
    done < "$file"
}

# Multi-stock K-line data fetch
fetch_multiple_klines() {
    local stock_file=$1
    local klt=${2:-101}
    local lmt=${3:-100}
    local end_date=${4:-$(date +%Y%m%d)}

    if [ ! -f "$stock_file" ]; then
        echo "Error: Stock file not found: $stock_file" >&2
        exit 1
    fi

    check_proxy_once

    echo "Fetching K-line data for multiple stocks..." >&2
    echo "Parameters: KLT=$klt, LMT=$lmt, END_DATE=$end_date" >&2

    while IFS= read -r stock_code; do
        # Skip empty lines and comments
        if [[ -n "$stock_code" && ! "$stock_code" =~ ^# ]]; then
            echo "Fetching: $stock_code" >&2

            if response=$(call_api_once "get_kline" "$stock_code" "$klt" "$lmt" "$end_date"); then
                stock_name=$(echo "$response" | jq -r '.data.name // "Unknown"')
                echo "SUCCESS: $stock_code - $stock_name"
                echo "$response"
            else
                echo "ERROR: Failed to fetch data for $stock_code" >&2
            fi

            sleep $CALL_DELAY
        fi
    done < "$stock_file"
}

# Usage function
print_usage() {
    echo "Usage:" >&2
    echo "  $0 <mode> [args...]" >&2
    echo ""
    echo "Modes:"
    echo "  single <command> [args...]     - Single API call"
    echo "  batch <command> [args...] <count> - Batch API calls"
    echo "  file <filename>              - API calls from file"
    echo "  klines <stock_file> [klt] [lmt] [end_date] - Multiple K-line data"
    echo ""
    echo "Environment Variables:"
    echo "  DISABLE_PROXY_ROTATION=true  Disable proxy rotation"
    echo "  BATCH_SIZE=N                Batch size for processing"
    echo "  BATCH_DELAY=N               Delay between batches"
    echo "  CALL_DELAY=N                Delay between calls"
    echo ""
    echo "Examples:"
    echo "  $0 single get_kline 1.600519 101 100 20250906"
    echo "  $0 batch get_kline 1.600519 101 100 20250906 5"
    echo "  $0 file api_calls.txt"
    echo "  $0 klines stocks.txt 101 50 20250906"
}

# Main logic
if [ $# -eq 0 ]; then
    echo "Error: No mode specified." >&2
    print_usage
    exit 1
fi

MODE=$1
shift

case "$MODE" in
    single)
        if [ $# -eq 0 ]; then
            echo "Error: No command specified for single mode." >&2
            print_usage
            exit 1
        fi
        check_proxy_once
        call_api_once "$@"
        ;;
    batch)
        if [ $# -lt 2 ]; then
            echo "Error: Insufficient arguments for batch mode." >&2
            print_usage
            exit 1
        fi
        # Extract count from the end
        count=${@: -1}
        # Get all arguments except the last one
        set -- "${@:1:$(( $# - 1 ))}"
        command=$1
        shift
        call_api_batch "$command" "$@" "$count"
        ;;
    file)
        if [ $# -eq 0 ]; then
            echo "Error: No file specified for file mode." >&2
            print_usage
            exit 1
        fi
        call_api_from_file "$1"
        ;;
    klines)
        if [ $# -eq 0 ]; then
            echo "Error: No stock file specified for klines mode." >&2
            print_usage
            exit 1
        fi
        stock_file=$1
        shift
        fetch_multiple_klines "$stock_file" "$@"
        ;;
    *)
        echo "Error: Unknown mode: $MODE" >&2
        print_usage
        exit 1
        ;;
esac