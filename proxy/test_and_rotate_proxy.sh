#!/bin/bash

# Script to test proxy IPs and rotate when current one is banned
# This version reads available proxies directly from the Clash configuration

# Configuration
PROXY_TEST_URL="http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20250906&lmt=1&_=1738771200000"
CLASH_CONFIG="/opt/clash/runtime.yaml"
PROXY_GROUP_NAME="lx"

# Function to extract proxy names from Clash config
get_proxy_list() {
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
    echo "Testing proxy: $proxy_name"
    
    # Update Clash to use this proxy
    update_clash_proxy "$proxy_name"
    
    # Wait a moment for the change to take effect
    sleep 2
    
    # Make a test request
    response=$(curl -s --max-time 10 "$PROXY_TEST_URL" | jq -r '.data' 2>/dev/null)
    
    # Check if response is valid (not empty and contains data)
    if [ -n "$response" ] && [ "$response" != "null" ]; then
        echo "Proxy $proxy_name is working"
        return 0
    else
        echo "Proxy $proxy_name is not working"
        return 1
    fi
}

# Function to update Clash configuration with new proxy
update_clash_proxy() {
    local proxy_name=$1
    
    if [ ! -f "$CLASH_CONFIG" ]; then
        echo "Clash config file not found: $CLASH_CONFIG"
        return 1
    fi
    
    # Create backup
    backup_file="${CLASH_CONFIG}.bak.$(date +%s)"
    cp "$CLASH_CONFIG" "$backup_file" || return 1
    
    # Update proxy in configuration
    target_line="name: $PROXY_GROUP_NAME"
    new_content="  - {name: $PROXY_GROUP_NAME, type: select, proxies: [$proxy_name]}"
    
    # Find target line number
    line_num=$(grep -n "$target_line" "$CLASH_CONFIG" | cut -d: -f1)
    
    if [ -n "$line_num" ]; then
        # Replace target line content
        sed -i "${line_num}s|.*|$(echo "$new_content" | sed 's/[&/\\]|/\\\\&/g')|" "$CLASH_CONFIG"
        echo "✅ Updated proxy to $proxy_name in Clash config"
    else
        # Target line doesn't exist, append to file
        echo "$new_content" >> "$CLASH_CONFIG"
        echo "⚠️ Added new proxy config for $proxy_name"
    fi
    
    # Send SIGHUP to reload configuration without restarting the process
    pkill -HUP -f mihomo
    echo "🔄 Clash configuration reloaded with new proxy"
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

# Function to rotate to next working proxy
rotate_proxy() {
    echo "Rotating to next working proxy..."
    
    # Get all proxies from the specified group
    proxies=$(get_proxy_list)
    if [ -z "$proxies" ]; then
        echo "No proxies found in group $PROXY_GROUP_NAME"
        return 1
    fi
    
    # Convert to array
    readarray -t proxy_array <<< "$proxies"
    
    # Test each proxy until we find a working one
    for proxy in "${proxy_array[@]}"; do
        if test_proxy "$proxy"; then
            echo "Found working proxy: $proxy"
            return 0
        fi
    done
    
    echo "No working proxies found"
    return 1
}

# Main function
main() {
    # If called with "rotate" argument, just rotate proxy
    if [ "$1" == "rotate" ]; then
        rotate_proxy
        return $?
    fi
    
    # If called with "list" argument, list all proxies
    if [ "$1" == "list" ]; then
        echo "Available proxies in group $PROXY_GROUP_NAME:"
        get_proxy_list
        return 0
    fi
    
    # Otherwise, check if we need to rotate
    echo "Checking if IP is banned..."
    # Make a test request
    response=$(curl -s --max-time 10 "$PROXY_TEST_URL" | jq -r '.data' 2>/dev/null)
    
    if is_ip_banned "$response"; then
        echo "IP appears to be banned. Rotating proxy..."
        rotate_proxy
        return $?
    else
        echo "IP is not banned. No action needed."
        return 0
    fi
}

# Run main function with all arguments
main "$@"