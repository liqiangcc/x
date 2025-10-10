# Proxy Management Scripts

This directory contains scripts to manage and rotate proxy IPs for accessing the Eastmoney/Tiantian Fund APIs.

## Scripts

1. `test_and_rotate_proxy.sh` - Main script that tests proxies and rotates when needed
2. `test_proxies.sh` - Manually test all proxies in the database
3. `rotate_proxy.sh` - Manually rotate to the next working proxy
4. `clash_as.sh` - Updated script that uses the new proxy management system

## How It Works

Instead of maintaining a separate database of proxies, this system reads available proxy lines directly from the Clash configuration file (`/opt/clash/runtime.yaml`). 

The script looks for a proxy group named "lx" and rotates through the proxies listed in that group.

## Usage

### Automatic Proxy Rotation
The `call_ttjj_api.sh` script automatically checks if the IP is banned and rotates proxies when needed.

To disable automatic proxy rotation (for testing or debugging), set the `DISABLE_PROXY_ROTATION` environment variable:
```bash
export DISABLE_PROXY_ROTATION=1
./call_ttjj_api.sh get_kline 1.600519 101 100 20250906
```

### Manual Testing
To manually test all proxies:
```bash
./test_proxies.sh
```

### Manual Rotation
To manually rotate to the next working proxy:
```bash
./rotate_proxy.sh
```

### List Available Proxies
To list all available proxies in the "lx" group:
```bash
./test_and_rotate_proxy.sh list
```

## Configuration

The scripts assume:
- Clash configuration file is at `/opt/clash/runtime.yaml`
- There is a proxy group named "lx" in the configuration
- `jq` is installed for JSON processing

## How It Works

1. When `call_ttjj_api.sh` is executed, it first runs `test_and_rotate_proxy.sh`
2. `test_and_rotate_proxy.sh` makes a test request to check if the current IP is banned
3. If the IP is banned, it tests all proxies in the "lx" group until it finds a working one
4. It then updates the Clash configuration to use the working proxy and sends a SIGHUP signal to reload the configuration

Note: The script uses `pkill -HUP -f mihomo` to reload the Clash configuration without restarting the service, which avoids port conflicts.