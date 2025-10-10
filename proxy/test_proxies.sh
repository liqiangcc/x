#!/bin/bash

# Script to manually test all proxies

echo "Testing all proxies in the lx group..."
proxies=$(/root/x/proxy/test_and_rotate_proxy.sh list | grep -v "Available proxies" | sed '/^\s*$/d')

if [ -z "$proxies" ]; then
    echo "No proxies found in the lx group"
    exit 1
fi

echo "Found proxies:"
echo "$proxies"

# Test each proxy
echo -e "\nTesting each proxy:"
while read -r proxy; do
    if [ -n "$proxy" ]; then
        echo "Testing proxy: $proxy"
        /root/x/proxy/test_and_rotate_proxy.sh rotate > /dev/null 2>&1
        # Add a delay between tests
        sleep 3
    fi
done <<< "$proxies"

echo "Proxy testing completed."