#!/bin/bash

# Proxy Manager Script
# Handles IP ban detection and proxy rotation for Eastmoney API requests
# This script can be used standalone or imported by other scripts

# Configuration
PROXY_TEST_URL="http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20250906&lmt=1&_=1738771200000"
CLASH_CONFIG="/opt/clash/runtime.yaml"
PROXY_GROUP_NAME="lx"
TEST_TIMEOUT=10

# Function to extract proxy names from Clash config
get_proxy_list() {
    if [ ! -f "$CLASH_CONFIG" ]; then
        echo "Error: Clash config file not found: $CLASH_CONFIG" >&2
        return 1
    fi

    # Extract proxy names from the specified proxy group
    sed -n '/proxy-groups:/,/^[[:space:]]*$/p' "$CLASH_CONFIG" | \
    grep -A 20 "name: $PROXY_GROUP_NAME" | \
    grep "proxies:" -A 10 | \
    head -n 1 | \
    sed 's/.*proxies:\s*\[\(.*\)\].*/\1/' | \
    tr ',' '\n' | \
    sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | \
    grep -v "^\s*$"
}

# Function to test if a proxy is working
test_proxy() {
    local proxy_name=$1
    echo "Testing proxy: $proxy_name" >&2

    # Update Clash to use this proxy
    if ! update_clash_proxy "$proxy_name"; then
        echo "Failed to update Clash proxy to $proxy_name" >&2
        return 1
    fi

    # Wait a moment for the change to take effect
    sleep 2

    # Make a test request
    response=$(curl -s --max-time "$TEST_TIMEOUT" "$PROXY_TEST_URL" | jq -r '.data' 2>/dev/null)

    # Check if response is valid (not empty and contains data)
    if [ -n "$response" ] && [ "$response" != "null" ]; then
        echo "✅ Proxy $proxy_name is working" >&2
        return 0
    else
        echo "❌ Proxy $proxy_name is not working" >&2
        return 1
    fi
}

# Function to update Clash configuration with new proxy
update_clash_proxy() {
    local proxy_name=$1

    if [ ! -f "$CLASH_CONFIG" ]; then
        echo "Error: Clash config file not found: $CLASH_CONFIG" >&2
        return 1
    fi

    # Get all available proxies first
    all_proxies=$(get_proxy_list)
    if [ -z "$all_proxies" ]; then
        echo "Error: No proxies found in group $PROXY_GROUP_NAME" >&2
        return 1
    fi

    # Create backup
    backup_file="${CLASH_CONFIG}.bak.$(date +%s)"
    cp "$CLASH_CONFIG" "$backup_file" || return 1

    # Update proxy in configuration - keep all proxies but move selected one to front
    # For select type, the first proxy in the list is the active one

    # Convert to array
    readarray -t proxy_array <<< "$all_proxies"

    # Find the selected proxy and move it to front
    new_proxies=("$proxy_name")
    for proxy in "${proxy_array[@]}"; do
        if [ "$proxy" != "$proxy_name" ]; then
            new_proxies+=("$proxy")
        fi
    done

    # Convert back to comma-separated string
    proxy_list=$(IFS=','; echo "${new_proxies[*]}")

    # Update configuration
    target_line="name: $PROXY_GROUP_NAME"
    new_content="  - {name: $PROXY_GROUP_NAME, type: select, proxies: [$proxy_list]}"

    # Find target line number
    line_num=$(grep -n "$target_line" "$CLASH_CONFIG" | cut -d: -f1)

    if [ -n "$line_num" ]; then
        # Replace target line content
        sed -i "${line_num}s|.*|$(echo "$new_content" | sed 's/[&/\\]|/\\\\&/g')|" "$CLASH_CONFIG"
        echo "✅ Updated proxy to $proxy_name in Clash config" >&2
    else
        # Target line doesn't exist, append to file
        echo "$new_content" >> "$CLASH_CONFIG"
        echo "⚠️ Added new proxy config for $proxy_name" >&2
    fi

    # Send SIGHUP to reload configuration without restarting the process
    if pkill -HUP -f mihomo; then
        echo "🔄 Clash configuration reloaded with new proxy" >&2
    else
        echo "⚠️ Failed to reload Clash configuration" >&2
    fi
}

# Function to check if current request failed due to IP ban
is_ip_banned() {
    local response=$1
    # Check if response is empty or indicates an error
    if [ -z "$response" ] || [ "$response" == "null" ] || [ "$response" == "{}" ]; then
        return 0  # IP is likely banned
    else
        return 1  # IP is not banned
    fi
}

# Function to get a random proxy from the list
get_random_proxy() {
    local proxies=$1

    # Convert to array
    readarray -t proxy_array <<< "$proxies"
    local array_length=${#proxy_array[@]}

    if [ $array_length -eq 0 ]; then
        echo ""
        return 1
    fi

    # Generate better random index using /dev/urandom
    local random_index=$(od -N 2 -A n -t u2 /dev/urandom | awk '{print $1 % '"$array_length"'}')
    echo "${proxy_array[$random_index]}"
}

# Function to shuffle array
shuffle_array() {
    local array=("$@")
    local i temp random_index

    # Fisher-Yates shuffle
    for ((i=${#array[@]}-1; i>0; i--)); do
        random_index=$((RANDOM % (i+1)))
        temp="${array[$i]}"
        array[$i]="${array[$random_index]}"
        array[$random_index]="$temp"
    done

    # Return shuffled array
    printf '%s\n' "${array[@]}"
}

# Function to rotate to next working proxy (sequential)
rotate_proxy() {
    echo "🔄 Rotating to next working proxy..." >&2

    # Get all proxies from the specified group
    proxies=$(get_proxy_list)
    if [ -z "$proxies" ]; then
        echo "❌ No proxies found in group $PROXY_GROUP_NAME" >&2
        return 1
    fi

    # Convert to array
    readarray -t proxy_array <<< "$proxies"

    # Test each proxy until we find a working one
    for proxy in "${proxy_array[@]}"; do
        if test_proxy "$proxy"; then
            echo "✅ Found working proxy: $proxy" >&2
            return 0
        fi
    done

    echo "❌ No working proxies found" >&2
    return 1
}

# Function to rotate to a random working proxy
rotate_proxy_random() {
    echo "🎲 Selecting random working proxy..." >&2

    # Get all proxies from the specified group
    proxies=$(get_proxy_list)
    if [ -z "$proxies" ]; then
        echo "❌ No proxies found in group $PROXY_GROUP_NAME" >&2
        return 1
    fi

    # Convert to array
    readarray -t proxy_array <<< "$proxies"

    # Shuffle the array for random selection
    mapfile -t shuffled_proxies < <(shuffle_array "${proxy_array[@]}")

    # Test each proxy in random order until we find a working one
    for proxy in "${shuffled_proxies[@]}"; do
        echo "🎲 Trying random proxy: $proxy" >&2
        if test_proxy "$proxy"; then
            echo "✅ Found working proxy: $proxy" >&2
            return 0
        fi
    done

    echo "❌ No working proxies found" >&2
    return 1
}

# Function to get a quick random proxy without full testing
get_random_proxy_fast() {
    echo "🎲 Getting random proxy (fast mode)..." >&2

    # Get all proxies from the specified group
    proxies=$(get_proxy_list)
    if [ -z "$proxies" ]; then
        echo "❌ No proxies found in group $PROXY_GROUP_NAME" >&2
        return 1
    fi

    # Get a random proxy
    random_proxy=$(get_random_proxy "$proxies")
    if [ -z "$random_proxy" ]; then
        echo "❌ Failed to get random proxy" >&2
        return 1
    fi

    echo "🎲 Selected random proxy: $random_proxy" >&2

    # Update Clash to use this proxy (without testing)
    if ! update_clash_proxy "$random_proxy"; then
        echo "❌ Failed to update Clash proxy to $random_proxy" >&2
        return 1
    fi

    echo "✅ Updated to random proxy: $random_proxy" >&2
    return 0
}

# Function to check current IP status
check_ip_status() {
    echo "🔍 Checking if IP is banned..." >&2

    # Make a test request
    response=$(curl -s --max-time "$TEST_TIMEOUT" "$PROXY_TEST_URL" | jq -r '.data' 2>/dev/null)

    if is_ip_banned "$response"; then
        echo "🚫 IP appears to be banned" >&2
        return 1
    else
        echo "✅ IP is not banned. No action needed." >&2
        return 0
    fi
}

# Function to check and rotate if needed
check_and_rotate() {
    if ! check_ip_status; then
        echo "🔄 IP banned detected, rotating proxy..." >&2
        rotate_proxy
        return $?
    else
        return 0
    fi
}

# Function to list available proxies
list_proxies() {
    echo "Available proxies in group $PROXY_GROUP_NAME:"
    get_proxy_list
}

# Function to show current proxy
show_current_proxy() {
    echo "Current proxy configuration:"
    if [ -f "$CLASH_CONFIG" ]; then
        grep -A 10 "name: $PROXY_GROUP_NAME" "$CLASH_CONFIG" | head -5
    else
        echo "Clash config not found: $CLASH_CONFIG"
    fi
}

# Function to check and rotate with random selection
check_and_rotate_random() {
    if ! check_ip_status; then
        echo "🔄 IP banned detected, rotating to random proxy..." >&2
        rotate_proxy_random
        return $?
    else
        return 0
    fi
}

# Main function
main() {
    case "${1:-check}" in
        check)
            check_ip_status
            ;;
        rotate)
            rotate_proxy
            ;;
        rotate-random)
            rotate_proxy_random
            ;;
        random-fast)
            get_random_proxy_fast
            ;;
        check-rotate)
            check_and_rotate
            ;;
        check-rotate-random)
            check_and_rotate_random
            ;;
        list)
            list_proxies
            ;;
        current)
            show_current_proxy
            ;;
        test)
            if [ -n "$2" ]; then
                test_proxy "$2"
            else
                echo "Usage: $0 test <proxy_name>"
                exit 1
            fi
            ;;
        *)
            echo "Usage: $0 {check|rotate|rotate-random|random-fast|check-rotate|check-rotate-random|list|current|test <proxy_name>}"
            echo ""
            echo "Commands:"
            echo "  check               - Check if current IP is banned"
            echo "  rotate              - Rotate to next working proxy (sequential)"
            echo "  rotate-random       - Rotate to random working proxy (with testing)"
            echo "  random-fast         - Switch to random proxy (no testing, fast)"
            echo "  check-rotate        - Check IP status and rotate if needed (sequential)"
            echo "  check-rotate-random - Check IP status and rotate to random if needed"
            echo "  list                - List all available proxies"
            echo "  current             - Show current proxy configuration"
            echo "  test <name>         - Test a specific proxy"
            exit 1
            ;;
    esac
}

# If script is executed directly, run main function
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi