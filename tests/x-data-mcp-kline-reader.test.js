"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  XDataMcpKlineReader,
  marketToExchange,
} = require("../src/adapters/xdata/x_data_mcp_kline_reader");

function versionRef({ dataset, exchange, code }) {
  return {
    contract_version: "v1",
    dataset,
    entity: { exchange, code },
    integrity_sha256: `integrity-${dataset}-${exchange}-${code}`,
    version_id: `${dataset}-${exchange}-${code}-v1`,
  };
}

function toolError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Single-version fake: `latest_per_entity` is the only version selector it
// serves, and list_data_versions must never be called.
function fakeClient({
  absent = false,
  records = [],
  manifestAdjustment = "qfq",
  manifestExtra = {},
  queryErrors = [],
  versionIdOf = null,
} = {}) {
  const calls = [];
  const errors = [...queryErrors];
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "query_data") {
        if (errors.length > 0) {
          const next = errors.shift();
          if (next) throw toolError(next);
        }
        assert.equal(args.version.kind, "latest_per_entity");
        const entity = args.selection.entity;
        const ref = {
          contract_version: "v1",
          dataset: args.dataset,
          entity,
          integrity_sha256: `integrity-${args.dataset}-${entity.exchange}-${entity.code}`,
          version_id: versionIdOf
            ? versionIdOf(calls.filter(({ name: n }) => n === "query_data").length)
            : `${args.dataset}-${entity.exchange}-${entity.code}-v1`,
        };
        return {
          records: absent ? [] : records.map((record) => ({ entity, version_ref: ref, ...record })),
          version_manifest: [absent ? { entity, status: "absent", version_ref: null, metadata: null, ...manifestExtra } : {
            entity,
            status: "present",
            metadata: {
              adjustment: manifestAdjustment === null ? null : {
                status: "confirmed",
                value: manifestAdjustment,
              },
            },
            version_ref: ref,
            ...manifestExtra,
          }],
          snapshot_id: "snapshot-1",
          query_time: "2026-09-29T00:00:00Z",
          limitations: ["fixed version selection is not a shared source acquisition time"],
          next_cursor: null,
          page_complete: true,
        };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
}

test("XDataMcpKlineReader maps daily QFQ records onto the existing kline reader contract", async () => {
  const client = fakeClient({
    records: [
      {
        date: "2026-09-25",
        open: "10.00",
        high: "10.50",
        low: "9.90",
        close: "10.20",
        volume: "1000",
        amount: "10200",
      },
      {
        date: "2026-09-28",
        open: "10.20",
        high: "10.40",
        low: "10.10",
        close: "10.30",
        volume: "1200",
        amount: "12360",
      },
    ],
  });
  const reader = new XDataMcpKlineReader({ client });
  const result = await reader.readRange({
    code: "600000",
    market: 1,
    startDate: "2026-09-25",
    endDate: "2026-09-28",
    period: "daily",
    limit: 10,
  });

  assert.equal(result.security.code, "600000");
  assert.equal(result.security.market, 1);
  assert.equal(result.dataMode, "legacy_approximate");
  assert.equal(result.priceView, "legacy_forward_adjusted");
  assert.equal(result.bars.length, 2);
  assert.deepEqual(result.bars.at(-1), {
    date: "2026-09-28",
    open: 10.2,
    high: 10.4,
    low: 10.1,
    close: 10.3,
    volume: 1200,
    amount: 12360,
    changePct: null,
  });
  assert.equal(result.source.kind, "x_data_mcp");
  assert.equal(result.source.dataset, "market.daily");
  assert.equal(result.contentHash, "integrity-market.daily-sh-600000");

  assert.equal(result.source.versionId, "market.daily-sh-600000-v1");
  assert.deepEqual(client.calls.map(({ name }) => name), ["query_data"]);
  assert.deepEqual(client.calls[0].args.version, { kind: "latest_per_entity" });
  assert.deepEqual(client.calls[0].args.filter, {
    kind: "daily",
    start_date: "2026-09-25",
    end_date: "2026-09-28",
  });
});

test("XDataMcpKlineReader keeps no client-side pin and maps yearly filters", async () => {
  const client = fakeClient();
  const reader = new XDataMcpKlineReader({ client });
  await reader.readRange({ code: "000001", market: 0, endDate: "2026-12-31", period: "yearly" });
  await reader.readRange({ code: "000001", market: 0, endDate: "2026-12-31", period: "yearly" });

  assert.equal(client.calls.filter(({ name }) => name === "list_data_versions").length, 0);
  assert.equal(client.calls.filter(({ name }) => name === "query_data").length, 2);
  assert.ok(client.calls.every(({ args }) => args.version.kind === "latest_per_entity"));
  assert.deepEqual(client.calls[0].args.filter, {
    kind: "yearly",
    start_year: 1900,
    end_year: 2026,
  });
});

test("XDataMcpKlineReader returns a missing-kline result when no published version exists", async () => {
  const client = fakeClient({ absent: true });
  const reader = new XDataMcpKlineReader({ client });
  const result = await reader.readRange({
    code: "301718",
    market: 0,
    endDate: "2026-09-28",
    period: "daily",
  });
  assert.equal(result.bars.length, 0);
  assert.deepEqual(result.qualityIssues, ["missing_daily_kline"]);
  assert.equal(result.contentHash, null);
});

test("XDataMcpKlineReader rejects a version without confirmed QFQ evidence", async () => {
  const client = fakeClient({ manifestAdjustment: "raw" });
  const reader = new XDataMcpKlineReader({ client });
  await assert.rejects(
    () => reader.readRange({ code: "600000", market: 1, endDate: "2026-09-28" }),
    (error) => error.code === "x_data_mcp_adjustment_not_confirmed"
  );
});

test("XDataMcpKlineReader retries once on stale_version and then succeeds", async () => {
  const client = fakeClient({
    queryErrors: ["stale_version"],
    records: [{ date: "2026-09-28", open: "1", high: "2", low: "1", close: "2", volume: "1", amount: "1" }],
  });
  const reader = new XDataMcpKlineReader({ client });
  const result = await reader.readRange({ code: "600000", market: 1, endDate: "2026-09-28" });
  assert.equal(result.bars.length, 1);
  assert.equal(client.calls.filter(({ name }) => name === "query_data").length, 2);
});

test("XDataMcpKlineReader throws when stale_version persists after the single retry", async () => {
  const client = fakeClient({ queryErrors: ["stale_version", "stale_version", "stale_version"] });
  const reader = new XDataMcpKlineReader({ client });
  await assert.rejects(
    () => reader.readRange({ code: "600000", market: 1, endDate: "2026-09-28" }),
    (error) => error.code === "stale_version"
  );
  assert.equal(client.calls.filter(({ name }) => name === "query_data").length, 2);
});

test("XDataMcpKlineReader never retries version_not_found or other errors", async () => {
  for (const code of ["version_not_found", "integrity_error", "storage_error"]) {
    const client = fakeClient({ queryErrors: [code, null] });
    const reader = new XDataMcpKlineReader({ client });
    await assert.rejects(
      () => reader.readRange({ code: "600000", market: 1, endDate: "2026-09-28" }),
      (error) => error.code === code
    );
    assert.equal(client.calls.filter(({ name }) => name === "query_data").length, 1, code);
  }
});

test("XDataMcpKlineReader passes yearly stale / as_of_day through to the caller", async () => {
  const client = fakeClient({
    records: [{ date: "2026-09-28", open: "1", high: "2", low: "1", close: "2", volume: "1", amount: "1" }],
    manifestExtra: { stale: "behind", as_of_day: "2026-09-25" },
  });
  const reader = new XDataMcpKlineReader({ client });
  const result = await reader.readRange({
    code: "600000", market: 1, endDate: "2026-12-31", period: "yearly",
  });
  assert.equal(result.bars.length, 1);
  assert.equal(result.source.stale, "behind");
  assert.equal(result.source.asOfDay, "2026-09-25");
  assert.ok(result.qualityIssues.includes("x_data_mcp_stale:behind"));
});

test("XDataMcpKlineReader reports an absent reason instead of hiding it", async () => {
  const client = fakeClient({ absent: true, manifestExtra: { reason: "daily_replaced_since_derivation" } });
  const reader = new XDataMcpKlineReader({ client });
  const result = await reader.readRange({
    code: "600000", market: 1, endDate: "2026-12-31", period: "yearly",
  });
  assert.equal(result.bars.length, 0);
  assert.deepEqual(result.qualityIssues, [
    "missing_yearly_kline",
    "x_data_mcp_absent_reason:daily_replaced_since_derivation",
  ]);
});

test("XDataMcpKlineReader rejects records that switch version between pages", async () => {
  const records = [{ date: "2026-09-28", open: "1", high: "2", low: "1", close: "2", volume: "1", amount: "1" }];
  const base = fakeClient({ records });
  let page = 0;
  const client = {
    calls: base.calls,
    async callTool(name, args) {
      const payload = await base.callTool(name, args);
      page += 1;
      if (page === 1) return { ...payload, next_cursor: "c1", page_complete: false };
      return {
        ...payload,
        records: payload.records.map((r) => ({ ...r, version_ref: { ...r.version_ref, version_id: "other" } })),
        version_manifest: [],
      };
    },
  };
  const reader = new XDataMcpKlineReader({ client });
  await assert.rejects(
    () => reader.readRange({ code: "600000", market: 1, endDate: "2026-09-28" }),
    (error) => error.code === "x_data_mcp_version_mismatch"
  );
});

test("marketToExchange rejects unsupported market ids", () => {
  assert.equal(marketToExchange(1), "sh");
  assert.equal(marketToExchange(0), "sz");
  assert.throws(() => marketToExchange(2), /supports market 1=sh and 0=sz/);
});
