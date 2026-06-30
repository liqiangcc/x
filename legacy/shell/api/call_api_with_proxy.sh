#!/bin/bash

# API Call Script with Proxy Management
# This script combines API calls with automatic proxy rotation
# Use this when you need reliable API calls with proxy failover

# Configuration
MAX_RETRIES=2          # 减少重试次数，提高频繁调用的响应速度
RETRY_DELAY=1          # 减少重试延迟
PROXY_CHECK_INTERVAL=300  # 代理检查间隔（秒），避免频繁检查

# Logging function - only output if DEBUG mode is enabled
log() {
    if [ "$DEBUG_MODE" = "true" ]; then
        echo "$@" >&2
    fi
}

# Proxy check function with caching
check_proxy_if_needed() {
    local current_time=$(date +%s)
    local last_check_file="/tmp/proxy_last_check"
    local should_check=false

    # Check if we need to do proxy check
    if [ "$DISABLE_PROXY_ROTATION" = "true" ]; then
        return 0
    fi

    # If no last check file, check proxy
    if [ ! -f "$last_check_file" ]; then
        should_check=true
    else
        local last_check_time=$(cat "$last_check_file" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_check_time))

        # Check if interval has passed
        if [ $time_diff -gt $PROXY_CHECK_INTERVAL ]; then
            should_check=true
        fi
    fi

    if [ "$should_check" = "true" ]; then
        log "Checking proxy status..."
        if /root/x/proxy/proxy_manager.sh check-rotate >/dev/null 2>&1; then
            echo "$current_time" > "$last_check_file"
            log "Proxy check completed"
        else
            log "Proxy check failed, trying to continue..."
        fi
    else
        log "Using cached proxy status (last check: $(( (current_time - $(cat "$last_check_file" 2>/dev/null || echo 0)) / 60 )) minutes ago)"
    fi
}

# --- Usage function ---
print_usage() {
    echo "Usage:" >&2
    echo "  $0 <api_command> [args...]" >&2
    echo ""
    echo "Environment Variables:"
    echo "  DEBUG_MODE=true    Enable debug logging (default: false)"
    echo "  DISABLE_PROXY_ROTATION=true  Disable proxy rotation (default: false)"
    echo "  PROXY_CHECK_INTERVAL=N  Proxy check interval in seconds (default: 300)"
    echo ""
    echo "Examples:"
    echo "  $0 get_kline 1.600519 101 100 20250906"
    echo "  DEBUG_MODE=true $0 get_kline 1.600519 101 100 20250906"
    echo "  $0 get_sectors 1"
    echo "  $0 get_stocks BK0433 1"
    echo ""
    echo "This script will automatically manage proxy rotation for reliable API calls."
}

# --- Command parsing ---
if [ $# -eq 0 ]; then
    echo "Error: No command provided." >&2
    print_usage
    exit 1
fi

COMMAND=$1
shift

# --- Proxy Management and API Call ---
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    log "Attempt $((RETRY_COUNT + 1))/$MAX_RETRIES for command: $COMMAND"

    # Check proxy only on first attempt or if previous attempt failed
    if [ $RETRY_COUNT -eq 0 ]; then
        check_proxy_if_needed
    else
        log "Retry after failure, checking proxy..."
        check_proxy_if_needed
    fi

    # Call the API script
    if response=$(/root/x/api/call_ttjj_api.sh "$COMMAND" "$@" 2>/dev/null); then
        log "API call successful!"
        echo "$response"
        exit 0
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))

    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        log "API call failed. Retrying in $RETRY_DELAY seconds..."
        sleep $RETRY_DELAY
    fi
done

echo "Error: Failed to execute '$COMMAND' after $MAX_RETRIES attempts." >&2
exit 1