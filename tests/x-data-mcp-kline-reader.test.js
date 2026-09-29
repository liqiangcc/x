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

function fakeClient({ versions = true, records = [], manifestAdjustment = "qfq" } = {}) {
  const calls = [];
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "list_data_versions") {
        return {
          items: versions ? [{ version_ref: versionRef({
            dataset: args.dataset,
            exchange: args.selection.entity.exchange,
            code: args.selection.entity.code,
          }) }] : [],
        };
      }
      if (name === "query_data") {
        const ref = versionRef({
          dataset: args.dataset,
          exchange: args.selection.entity.exchange,
          code: args.selection.entity.code,
        });
        return {
          records: records.map((record) => ({ entity: args.selection.entity, version_ref: ref, ...record })),
          version_manifest: [{
            entity: args.selection.entity,
            status: "present",
            metadata: {
              adjustment: manifestAdjustment === null ? null : {
                status: "confirmed",
                value: manifestAdjustment,
              },
            },
            version_ref: ref,
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

  assert.equal(client.calls[0].name, "list_data_versions");
  assert.equal(client.calls[1].name, "query_data");
  assert.equal(client.calls[1].args.version.kind, "explicit_version_map");
  assert.equal(
    client.calls[1].args.version.versions[0].version_id,
    "market.daily-sh-600000-v1"
  );
  assert.deepEqual(client.calls[1].args.filter, {
    kind: "daily",
    start_date: "2026-09-25",
    end_date: "2026-09-28",
  });
});

test("XDataMcpKlineReader pins the resolved version and maps yearly filters", async () => {
  const client = fakeClient();
  const reader = new XDataMcpKlineReader({ client });
  await reader.readRange({ code: "000001", market: 0, endDate: "2026-12-31", period: "yearly" });
  await reader.readRange({ code: "000001", market: 0, endDate: "2026-12-31", period: "yearly" });

  assert.equal(client.calls.filter(({ name }) => name === "list_data_versions").length, 1);
  assert.equal(client.calls.filter(({ name }) => name === "query_data").length, 2);
  assert.deepEqual(client.calls[1].args.filter, {
    kind: "yearly",
    start_year: 1900,
    end_year: 2026,
  });
});

test("XDataMcpKlineReader returns a missing-kline result when no published version exists", async () => {
  const client = fakeClient({ versions: false });
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

test("marketToExchange rejects unsupported market ids", () => {
  assert.equal(marketToExchange(1), "sh");
  assert.equal(marketToExchange(0), "sz");
  assert.throws(() => marketToExchange(2), /supports market 1=sh and 0=sz/);
});
