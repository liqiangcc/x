#!/bin/bash

# Clash API endpoint. Change if your configuration is different.
API_URL="http://127.0.0.1:9090"

# URL for testing latency.
TEST_URL="http://www.gstatic.com/generate_204"
# Timeout for the test in milliseconds.
TIMEOUT=3000

# Fetch the list of proxy names from the Clash API.
# This filters for common proxy types and excludes utility types like Selectors.
proxy_names=$(curl -s "$API_URL/proxies" | jq -r '.proxies[] | select(.type | IN("Vmess", "Shadowsocks", "Trojan", "Snell", "Socks5", "Http")).name')

# Check if any proxies were found
if [ -z "$proxy_names" ]; then
    echo "Error: Could not fetch proxies from the Clash API at $API_URL" >&2
    echo "Please ensure Clash is running and the API is accessible." >&2
    exit 1
fi

echo "Pinging proxies..."

# Loop through each proxy name and test its delay.
while IFS= read -r proxy_name; do
    # URL-encode the proxy name to handle special characters.
    encoded_name=$(jq -s -R -r @uri <<<"$proxy_name")
    
    # Make the API call to test the delay.
    response=$(curl -s "$API_URL/proxies/$encoded_name/delay?timeout=$TIMEOUT&url=$TEST_URL")
    
    # Extract the delay value.
    delay=$(echo "$response" | jq -r '.delay')

    if [[ "$delay" != "null" && "$delay" -gt 0 ]]; then
        printf "  %-40s : %dms\n" "$proxy_name" "$delay"
    else
        printf "  %-40s : Timeout or Error\n" "$proxy_name"
    fi
done <<< "$proxy_names"
