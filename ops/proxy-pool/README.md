# Local CN proxy pool

This deployment builds `Python3WebSpider/ProxyPool` from pinned commit
`cabcd96cc9f30d7bdbc872bb8a8c52760023c142` (MIT) and exposes its API on localhost only. Redis is internal to
the Compose network.

```bash
cp ops/proxy-pool/.env.example ops/proxy-pool/.env
# replace PROXY_POOL_API_KEY (for example: openssl rand -hex 32), then:
bin/x proxy pool up
bin/x proxy pool status
bin/x proxy pool warmup --duration 30m
bin/x proxy pool benchmark --samples 100 --json
bin/x proxy pool verify --concurrency 8 --timeout-ms 6000
```

The upstream tester is only a coarse filter. `x` revalidates every selected
proxy against an HTTPS Eastmoney kline response with normal TLS certificate
verification before using it.

`verify` checks every current candidate exactly once and writes a JSON report
plus an `available.txt` file sorted by observed latency under `runs/proxy-verify/`.
