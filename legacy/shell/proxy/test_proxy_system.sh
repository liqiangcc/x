#!/bin/bash

# Enhanced test script to verify the proxy rotation system with more detailed output

echo "=== Proxy Rotation System Test ==="

echo "1. Listing available proxies:"
/root/x/proxy/test_and_rotate_proxy.sh list

echo -e "\n2. Testing if current IP is banned:"
# Make a direct test request without proxy rotation first
echo "Making direct test request..."
direct_response=$(curl -s --max-time 10 "http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20250906&lmt=1&_=1738771200000" | jq -r '.data' 2>/dev/null)

if [ -n "$direct_response" ] && [ "$direct_response" != "null" ]; then
    echo "Direct request succeeded. Response: $direct_response"
else
    echo "Direct request failed or returned empty response"
fi

echo -e "\n3. Testing proxy rotation system:"
/root/x/proxy/test_and_rotate_proxy.sh

echo -e "\n4. Testing manual rotation:"
/root/x/proxy/rotate_proxy.sh