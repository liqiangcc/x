# Cloudflare Tunnel

该部署让 Tunnel 出口使用独立网桥 `cloudflare-direct`。容器访问宿主机已有的
Docker 网关地址时，会经该网桥的默认网关交给宿主机本地路由。mihomo 的持久配置必须将宿主机接口
`cf-direct` 加入 `tun.exclude-interface`，否则 Tunnel 会再次经过 fake-IP/TUN。

首次创建网络：

```bash
docker network create \
  --driver bridge \
  --subnet 172.30.0.0/24 \
  --opt com.docker.network.bridge.name=cf-direct \
  cloudflare-direct
```

启动时从受保护的环境注入 Token，不要将 Token 写入仓库：

```bash
export CLOUDFLARE_TUNNEL_TOKEN='<token>'
docker compose -f ops/cloudflared/compose.yml up -d
```

验证日志应显示真实 Cloudflare Edge IP（例如 `198.41.x.x`）和
`protocol=quic`，不应显示 mihomo fake-IP 网段 `28.0.0.x`：

```bash
docker logs --since 2m vibrant_lehmann
curl --fail https://x.1879736.xyz/
```

回滚时先执行 `docker compose -f ops/cloudflared/compose.yml down`，恢复原容器
或让 Tunnel 仅连接 Docker 默认 `bridge`，并从 mihomo 配置移除对应排除项。
