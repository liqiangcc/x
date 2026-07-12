# Proxy and Kline policy architecture

The proxy subsystem is intentionally independent from stock workflows:

1. A provider returns normalized proxy records (`id`, `endpoint`, `protocol`, `region`, `source`).
2. A selector ranks records from target-scoped health history.
3. The transport performs a generic HTTPS request through exactly one proxy.
4. A probe owns target allowlisting and response validation.
5. `ProxyManager` coordinates attempts and records results; it does not know about daily or yearly bars.

Health state uses JSON schema v2 under `var/proxy-pool/`. Each proxy contains independent target histories, each limited to the latest 20 samples. Reading schema v1 migrates its existing Eastmoney measurements in memory; the next result writes v2 atomically.

Selectors are `balanced` (default), `fastest`, `reliable`, and `round-robin`. `balanced` combines recent success rate, EWMA latency, and recent success, with a 10% exploration rate for unproven candidates.

Kline engines expose one contract:

```js
engine.fetchKline({ secid, period, limit, context });
```

Named policies in `config/kline.json` compose engines and their attempt settings. `auto` retains the safe cloud-to-local chain and does not introduce free proxies implicitly. Use `proxy-first`, `proxy-only`, or `cloud-first` when that behavior is intended.

To add a proxy source, implement `listCandidates(context)` and register it with `ProxyManager`. To add a target, implement a probe with `target`, `request`, and `validate(response)`. To add a Kline backend, register an engine and reference its name from a policy; proxy selection and health code should not change.
