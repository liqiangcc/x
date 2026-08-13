"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assertEtfSnapshotTransport,
} = require("../src/ports/market/etf_snapshot_transport");
const {
  OfficialExportFileTransport,
  sha256,
} = require("../src/sources/exchange/official_export_file_transport");
const {
  OfficialExchangeEtfSource,
} = require("../src/sources/exchange/official_etf_source");

function tempFile(name, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-official-etf-transport-"));
  const file = path.join(root, name);
  fs.writeFileSync(file, content);
  return { root, file };
}

function transport(options) {
  return new OfficialExportFileTransport({
    exchange: "sse",
    dataset: "all_etfs",
    document: "https://etf.sse.com.cn/fundlist/",
    version: "20260813",
    collectedAt: "2026-08-13T02:00:00Z",
    expectedRecordCount: 2,
    ...options,
  });
}

test("ETF snapshot transport port stays narrow", () => {
  const fake = { async readSnapshot() { return { complete: true, records: [] }; } };
  assert.equal(assertEtfSnapshotTransport(fake), fake);
  assert.throws(() => assertEtfSnapshotTransport(null), /must be an object/);
  assert.throws(() => assertEtfSnapshotTransport({}), /readSnapshot/);
});

test("official export transport converts complete CSV export into the standard snapshot contract", async () => {
  const fixture = tempFile(
    "all.csv",
    "基金代码,基金扩位简称,上市日期\n510300,沪深300ETF,2012-05-28\n511010,国债ETF,2013-03-25\n"
  );
  try {
    const raw = fs.readFileSync(fixture.file);
    const result = await transport({
      filePath: fixture.file,
      expectedContentHash: sha256(raw),
    }).readSnapshot();

    assert.equal(result.complete, true);
    assert.deepEqual(result.records, [
      { code: "510300", listingDate: "2012-05-28" },
      { code: "511010", listingDate: "2013-03-25" },
    ]);
    assert.equal(result.source.document, "https://etf.sse.com.cn/fundlist/");
    assert.equal(result.source.version, "20260813");
    assert.match(result.source.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(result.transport, {
      kind: "official_export_file",
      exchange: "sse",
      dataset: "all_etfs",
      format: "csv",
      expectedRecordCount: 2,
      actualRecordCount: 2,
      contentHash: result.source.contentHash,
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("official export transport reads HTML-table T+0 exports without deriving eligibility from names or prefixes", async () => {
  const fixture = tempFile(
    "t0.xls.html",
    "<html><body><table><tr><th>基金代码</th><th>基金简称</th></tr>"
      + "<tr><td>511010</td><td>国债ETF</td></tr>"
      + "<tr><td>513500</td><td>标普500ETF</td></tr></table></body></html>"
  );
  try {
    const result = await new OfficialExportFileTransport({
      exchange: "sse",
      dataset: "t0_etfs",
      filePath: fixture.file,
      document: "https://www.sse.com.cn/assortment/fund/list/",
      version: "20260813-t0",
      collectedAt: "2026-08-13T02:00:00Z",
      expectedRecordCount: 2,
    }).readSnapshot();

    assert.equal(result.transport.format, "html_table");
    assert.deepEqual(result.records, [{ code: "511010" }, { code: "513500" }]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("official export transport fails closed on record-count, content-hash, domain, and binary Excel mismatches", async () => {
  const csv = tempFile("all.csv", "基金代码,上市日期\n510300,2012-05-28\n");
  const xlsx = tempFile("all.xlsx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
  try {
    await assert.rejects(
      () => transport({ filePath: csv.file }).readSnapshot(),
      /record count mismatch/
    );
    await assert.rejects(
      () => transport({
        filePath: csv.file,
        expectedRecordCount: 1,
        expectedContentHash: "sha256:" + "0".repeat(64),
      }).readSnapshot(),
      /content hash mismatch/
    );
    assert.throws(
      () => transport({
        filePath: csv.file,
        expectedRecordCount: 1,
        document: "https://example.com/fundlist/",
      }),
      /must belong to sse.com.cn/
    );
    await assert.rejects(
      () => transport({ filePath: xlsx.file }).readSnapshot(),
      /binary XLSX\/ZIP export is not supported/
    );
  } finally {
    fs.rmSync(csv.root, { recursive: true, force: true });
    fs.rmSync(xlsx.root, { recursive: true, force: true });
  }
});

test("official ETF source preserves transport hashes as writer metadata evidence", async () => {
  const source = new OfficialExchangeEtfSource({
    exchange: "sse",
    fetchAllEtfs: async () => ({
      complete: true,
      records: [{ code: "510300", listingDate: "2012-05-28" }],
      source: {
        document: "https://etf.sse.com.cn/fundlist/",
        version: "all-v1",
        collectedAt: "2026-08-13T02:00:00Z",
        contentHash: "sha256:" + "1".repeat(64),
      },
    }),
    fetchT0Etfs: async () => ({
      complete: true,
      records: [],
      source: {
        document: "https://www.sse.com.cn/assortment/fund/list/",
        version: "t0-v1",
        collectedAt: "2026-08-13T02:01:00Z",
        contentHash: "sha256:" + "2".repeat(64),
      },
    }),
  });

  const result = await source.fetchFacts();
  assert.deepEqual(result.source.evidence, {
    allContentHash: "sha256:" + "1".repeat(64),
    t0ContentHash: "sha256:" + "2".repeat(64),
  });
  assert.equal(result.records[0].source.document.includes("all=https://"), true);
  assert.equal(Object.hasOwn(result.records[0].source, "contentHash"), false);
});
