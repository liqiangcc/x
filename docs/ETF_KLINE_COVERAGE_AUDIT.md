# SSE ETF Security Master / Kline Coverage Audit

## Purpose

This audit answers one narrow repository question:

> Which securities from the accepted SSE ETF Security Master dataset also have real Kline data in the repository, and which execution profile does the existing security-metadata resolution path select for them?

It is a downstream coverage check. It is **not** an ETF classifier, exchange-rule implementation, Kline downloader, or simulation engine.

The audit deliberately reuses the existing boundaries:

```text
LedgerSecurityMasterReader
        ↓
LedgerSecurityMetadataReader
        ↓
SecurityExecutionProfileResolver

LedgerKlineReader
        ↓
existing repo Kline ledger
```

The script must not infer T+0/T+1 from code prefixes or duplicate exchange eligibility rules.

## Command

From the repository root:

```bash
node scripts/audit_etf_kline_coverage.js
```

The output is deterministic JSON derived only from committed repository data. A security is counted as:

- `withKlineCount` when at least one real bar exists;
- `runnableCount` when at least two real bars exist, which is the minimum useful shape for the current next-trading-bar execution model.

## Baseline after the accepted SSE ETF snapshot was published

Audit run against commit `e6e3f5c5cac179c38b9e619e798ac90e9c1a7adb` on 2026-08-13 produced:

```text
SSE ETF Security Master securities: 917

T+0 profile (t0_etf):
  securities: 192
  with Kline: 0
  runnable:   0

T+1 stock ETF profile (domestic_stock_etf):
  securities: 725
  with Kline: 0
  runnable:   0

Total real ETF/Kline overlap: 0
```

Therefore the repository currently cannot provide a truthful end-to-end MCP simulation fixture that simultaneously uses:

1. a real SSE ETF Security Master record,
2. automatic execution-profile selection,
3. and real committed ETF Kline history.

No synthetic ETF Kline should be added merely to make that acceptance test green.

## Real stdio E2E admission rule

A real `simulation_run_drawdown_buying` stdio E2E may be added when the audit finds at least:

- one `t0_etf` security with `runnableCount >= 1`, and
- one `domestic_stock_etf` security with `runnableCount >= 1`.

The E2E should omit `executionModel` and assert that the existing chain selects the corresponding profile through Security Master metadata. The MCP adapter must not classify the security itself.

## Historical-time caveat

The current simulation Application asks the `SecurityMetadataReader` for metadata without passing the simulation `endDate` as an `asOf` date. That means automatic selection currently uses the latest effective Security Master record, even when the available Kline history is older.

This audit reports `metadataEffectiveFrom` / `metadataEffectiveTo` for covered samples so that future real E2E work cannot silently confuse current classification with historically effective classification.

Historical rule-time alignment is a separate responsibility from Kline coverage. It should be fixed by carrying an explicit `asOf` through the Application → metadata-reader boundary, not by adding date logic to MCP or to this audit script.
