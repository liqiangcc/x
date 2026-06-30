#!/bin/bash

# API Call Script with Intelligent Rate Limiting
# This script implements per-proxy rate limiting for optimal success rates

# Configuration
MAX_RETRIES=2
RETRY_DELAY=1
PROXY_CHECK_INTERVAL=300
MIN_CALL_INTERVAL=30      # Minimum interval between calls in seconds
BLOCK_TIMEOUT=20          # Seconds to wait when proxy is not ready

# Rate limiting state directory
RATE_LIMIT_DIR="/tmp/api_rate_limits"
mkdir -p "$RATE_LIMIT_DIR"

# Logging function
log() {
    if [ "$DEBUG_MODE" = "true" ]; then
        echo "$@" >&2
    fi
}

# Get current timestamp
get_timestamp() {
    date +%s
}

# Clean old rate limit records
cleanup_old_records() {
    local current_time=$(get_timestamp)
    find "$RATE_LIMIT_DIR" -name "*.calls" -type f -exec rm -f {} \; 2>/dev/null
}

# Record API call for a proxy
record_call() {
    local proxy_id="$1"
    local current_time=$(get_timestamp)
    local call_file="$RATE_LIMIT_DIR/${proxy_id}.calls"

    # Record timestamp of this call
    echo "$current_time" > "$call_file"
}

# Get last call timestamp for a proxy
get_last_call_time() {
    local proxy_id="$1"
    local call_file="$RATE_LIMIT_DIR/${proxy_id}.calls"

    if [ ! -f "$call_file" ]; then
        echo 0
        return
    fi

    # Get the most recent call timestamp
    sort -n "$call_file" 2>/dev/null | tail -1 || echo 0
}

# Check if proxy is ready for next call
is_proxy_ready() {
    local proxy_id="$1"
    local min_interval="${2:-$MIN_CALL_INTERVAL}"
    local current_time=$(get_timestamp)
    local last_call_time=$(get_last_call_time "$proxy_id")

    if [ "$last_call_time" -eq 0 ]; then
        return 1  # No previous calls, proxy is ready
    fi

    local time_since_last_call=$((current_time - last_call_time))

    if [ "$time_since_last_call" -ge "$min_interval" ]; then
        return 1  # Proxy is ready
    else
        return 0  # Proxy is not ready yet
    fi
}

# Get time until proxy is ready
get_time_until_ready() {
    local proxy_id="$1"
    local min_interval="${2:-$MIN_CALL_INTERVAL}"
    local current_time=$(get_timestamp)
    local last_call_time=$(get_last_call_time "$proxy_id")

    if [ "$last_call_time" -eq 0 ]; then
        echo 0
        return
    fi

    local time_since_last_call=$((current_time - last_call_time))
    local time_until_ready=$((min_interval - time_since_last_call))

    if [ "$time_until_ready" -lt 0 ]; then
        echo 0
    else
        echo "$time_until_ready"
    fi
}

# Get shortest time until any proxy is ready
get_shortest_wait_time() {
    local shortest_time=999999

    while IFS= read -r proxy_id; do
        if [ -n "$proxy_id" ]; then
            local time_until_ready=$(get_time_until_ready "$proxy_id")
            if [ "$time_until_ready" -lt "$shortest_time" ]; then
                shortest_time="$time_until_ready"
            fi
        fi
    done < <(get_available_proxies)

    echo "$shortest_time"
}

# Get current proxy ID
get_current_proxy_id() {
    if [ -f "/tmp/current_proxy_id" ]; then
        cat "/tmp/current_proxy_id"
    else
        echo "default"
    fi
}

# Get list of available proxies
get_available_proxies() {
    # Return actual proxy names from Clash configuration
    echo "default"  # No proxy
    echo "新加坡-优化3"
    echo "台湾-优化2-GPT"
    echo "日本-优化"
    echo "美国LA-优化3-GPT"
    echo "日本-优化3"
    echo "香港-优化2"
    echo "美国LA-优化2-GPT"
    echo "台湾-优化"
    echo "香港-优化"
    echo "美国LA-优化-GPT"
    echo "英国-优化-GPT"
    echo "台湾-优化3"
    echo "日本-优化2"
    echo "新加坡-优化"
    echo "新加坡-优化2"
    echo "香港-优化3"
}

# Find the best available proxy (ready for call) using round-robin
find_best_proxy() {
    local current_proxy="$1"

    # Get all proxies in round-robin order
    local current_proxy_id=$(get_current_proxy_id)
    local proxies=()
    while IFS= read -r proxy_id; do
        if [ -n "$proxy_id" ]; then
            proxies+=("$proxy_id")
        fi
    done < <(get_available_proxies)

    # Find current proxy index
    local current_index=-1
    for i in "${!proxies[@]}"; do
        if [ "${proxies[i]}" = "$current_proxy_id" ]; then
            current_index=$i
            break
        fi
    done

    # Start from next proxy in round-robin, or from beginning if current not found
    local start_index=$(( (current_index + 1) % ${#proxies[@]} ))
    local i=$start_index

    # Try each proxy in round-robin order
    while true; do
        local proxy_id="${proxies[i]}"
        local time_until_ready=$(get_time_until_ready "$proxy_id")

        log "Proxy $proxy_id: $time_until_ready seconds until ready"

        if [ "$time_until_ready" -eq 0 ]; then
            log "Found ready proxy: $proxy_id"
            echo "$proxy_id"
            return 0
        fi

        # Move to next proxy in round-robin
        i=$(( (i + 1) % ${#proxies[@]} ))

        # If we've checked all proxies and none are ready, break
        if [ $i -eq $start_index ]; then
            break
        fi
    done

    # No ready proxy found
    log "No ready proxy found"
    echo ""
}

# Force switch to next proxy
switch_to_next_proxy() {
    local current_proxy=$(get_current_proxy_id)
    log "Current proxy $current_proxy is not ready, switching to next..."

    # Get all proxies
    local proxies=()
    while IFS= read -r proxy_id; do
        if [ -n "$proxy_id" ]; then
            proxies+=("$proxy_id")
        fi
    done < <(get_available_proxies)

    # Find current proxy index
    local current_index=-1
    for i in "${!proxies[@]}"; do
        if [ "${proxies[i]}" = "$current_proxy" ]; then
            current_index=$i
            break
        fi
    done

    # Try next proxies in round-robin fashion
    for ((i=1; i<${#proxies[@]}; i++)); do
        local next_index=$(( (current_index + i) % ${#proxies[@]} ))
        local next_proxy="${proxies[next_index]}"

        local time_until_ready=$(get_time_until_ready "$next_proxy")
        log "Checking proxy $next_proxy: $time_until_ready seconds until ready"

        if [ "$time_until_ready" -eq 0 ]; then
            log "Switched to ready proxy: $next_proxy"
            echo "$next_proxy" > "/tmp/current_proxy_id"
            echo "$next_proxy"
            return 0
        fi
    done

    # No ready proxy found
    log "No ready proxy found for switching"
    echo ""
}

# Wait for proxy to be ready
wait_for_proxy_ready() {
    local max_wait=${1:-120}  # Maximum wait time in seconds
    local waited=0

    log "No proxy is ready. Waiting for available slot..."

    while [ "$waited" -lt "$max_wait" ]; do
        local available_proxy=$(find_best_proxy)
        if [ -n "$available_proxy" ]; then
            log "Found ready proxy: $available_proxy"
            echo "$available_proxy"
            return 0
        fi

        # Calculate optimal wait time
        local shortest_wait=$(get_shortest_wait_time)
        if [ "$shortest_wait" -gt 0 ]; then
            log "Shortest wait time: $shortest_wait seconds"
            if [ "$shortest_wait" -le "$BLOCK_TIMEOUT" ]; then
                sleep "$shortest_wait"
            else
                sleep "$BLOCK_TIMEOUT"
            fi
        else
            sleep "$BLOCK_TIMEOUT"
        fi

        waited=$((waited + BLOCK_TIMEOUT))
        log "Still waiting... ($waited/$max_wait seconds)"
    done

    log "No proxy ready after $max_wait seconds"
    return 1
}

# Proxy check function with rate limiting awareness
check_proxy_if_needed() {
    local current_time=$(get_timestamp)
    local last_check_file="/tmp/proxy_last_check"
    local should_check=false

    if [ "$DISABLE_PROXY_ROTATION" = "true" ]; then
        return 0
    fi

    if [ ! -f "$last_check_file" ]; then
        should_check=true
    else
        local last_check_time=$(cat "$last_check_file" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_check_time))

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

# Switch to actual proxy based on proxy name
switch_to_actual_proxy() {
    local proxy_name="$1"

    if [ "$proxy_name" = "default" ]; then
        log "Using default connection (no proxy)"
        # For default, we'll use whatever is currently configured
        return 0
    fi

    log "Attempting to use proxy: $proxy_name"

    # Test the proxy first to see if it's available
    if /root/x/proxy/proxy_manager.sh test "$proxy_name" >/dev/null 2>&1; then
        log "Proxy $proxy_name is available, using it"
        # Note: The actual proxy switching mechanism depends on your setup
        # This might involve updating Clash configuration or other proxy settings
        return 0
    else
        log "Proxy $proxy_name test failed, but will attempt API call anyway"
        return 1
    fi
}

# API call with rate limiting
call_api_with_rate_limit() {
    local command="$1"
    shift

    # Clean up old records periodically
    if [ $(( RANDOM % 100 )) -lt 5 ]; then  # 5% chance to cleanup
        cleanup_old_records
    fi

    # Try to find an available proxy
    local best_proxy=$(find_best_proxy)

    if [ -z "$best_proxy" ]; then
        log "No proxy is ready. Waiting for available slot..."
        best_proxy=$(wait_for_proxy_ready)
        if [ -z "$best_proxy" ]; then
            echo "Error: No proxy ready after timeout" >&2
            return 1
        fi
    fi

    log "Selected proxy: $best_proxy"

    # Switch to actual proxy configuration
    switch_to_actual_proxy "$best_proxy"

    # Update current proxy
    echo "$best_proxy" > "/tmp/current_proxy_id"

    # Record the call
    record_call "$best_proxy"

    # Check proxy if needed
    check_proxy_if_needed

    # Make the API call
    local response
    if response=$(/root/x/api/call_ttjj_api.sh "$command" "$@" 2>/dev/null); then
        log "API call successful!"
        echo "$response"
        return 0
    else
        log "API call failed"
        return 1
    fi
}

# Usage function
print_usage() {
    echo "Usage:" >&2
    echo "  $0 <api_command> [args...]" >&2
    echo ""
    echo "Environment Variables:"
    echo "  DEBUG_MODE=true                    Enable debug logging (default: false)"
    echo "  DISABLE_PROXY_ROTATION=true      Disable proxy rotation (default: false)"
    echo "  PROXY_CHECK_INTERVAL=N           Proxy check interval in seconds (default: 300)"
    echo "  MIN_CALL_INTERVAL=N              Minimum interval between calls in seconds (default: 20)"
    echo "  BLOCK_TIMEOUT=N                  Wait time when proxy is busy (default: 20)"
    echo ""
    echo "Features:"
    echo "  - Minimum 20-second interval between calls per proxy"
    echo "  - Intelligent proxy selection"
    echo "  - Automatic wait when proxy is not ready"
    echo "  - Call timing tracking"
    echo "  - Proxy readiness checking"
    echo ""
    echo "Examples:"
    echo "  $0 get_kline 1.600519 101 100 20250906"
    echo "  DEBUG_MODE=true $0 get_kline 1.600519 101 100 20250906"
    echo ""
    echo "Rate Limiting:"
    echo "  - Default: 20-second minimum interval between calls per proxy"
    echo "  - Automatic wait when proxy is not ready"
    echo "  - Intelligent proxy selection based on availability"
}

# Command parsing
if [ $# -eq 0 ]; then
    echo "Error: No command provided." >&2
    print_usage
    exit 1
fi

COMMAND=$1
shift

# Rate limited API call with retries
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    log "Attempt $((RETRY_COUNT + 1))/$MAX_RETRIES for command: $COMMAND"

    if call_api_with_rate_limit "$COMMAND" "$@"; then
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