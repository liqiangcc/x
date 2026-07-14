# Local CN proxy pool

This deployment builds `Python3WebSpider/ProxyPool` from pinned commit
`cabcd96cc9f30d7bdbc872bb8a8c52760023c142` (MIT) and exposes its API on localhost only. Redis is internal to
the Compose network.

```bash
cp ops/proxy-pool/.env.example ops/proxy-pool/.env
# replace PROXY_POOL_API_KEY (for example: openssl rand -hex 32), then:
bin/x proxy pool up
bin/x proxy pool status
bin/x proxy pool refresh-github
bin/x proxy pool warmup --duration 30m
bin/x proxy pool benchmark --samples 100 --json
bin/x proxy pool verify --concurrency 8 --timeout-ms 6000
```

The upstream tester is only a coarse filter. `x` revalidates every selected
proxy against an HTTPS Eastmoney kline response with normal TLS certificate
verification before using it.

Every batch preflight also conditionally pulls the country-specific CN list from
[`proxifly/free-proxy-list`](https://github.com/proxifly/free-proxy-list) (GPL-3.0)
through the GitHub Contents API. Only entries declared as CN HTTP proxies with
HTTPS tunnelling support are accepted, deduplicated with the local scraper pool,
and then verified against Eastmoney. The cached list is used for at most six
hours when GitHub is temporarily unavailable.

The source can be replaced without code changes:

```bash
X_PROXY_GITHUB_REPO=owner/repository
X_PROXY_GITHUB_REF=main
X_PROXY_GITHUB_PATH=path/to/cn.json
X_PROXY_GITHUB_ENABLED=true
```

`verify` checks every current candidate exactly once and writes a JSON report
plus an `available.txt` file sorted by observed latency under `runs/proxy-verify/`.
