"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const XLSX = require("xlsx");
const {
  OfficialExportFileTransport,
} = require("../src/sources/exchange/official_export_file_transport");
const {
  resolveOfficialSnapshotTransport,
} = require("../src/sources/exchange/official_snapshot_transport_resolver");
const {
  VERIFIED_SSE_XLS_HEADERS,
  VerifiedXlsSnapshotTransport,
} = require("../src/sources/exchange/verified_xls_snapshot_transport");

const COMMON = Object.freeze({
  exchange: "sse",
  dataset: "all_etfs",
  document: "https://etf.sse.com.cn/fundlist/",
  version: "V3.1.0_20260304",
  collectedAt: "2026-08-13T05:33:25Z",
  expectedRecordCount: 1,
});

function createSseXlsFixture() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...VERIFIED_SSE_XLS_HEADERS],
    [
      "510010",
      "治理ETF",
      "180治理ETF交银",
      "上证180公司治理指数",
      "2009-12-15",
      "2.2972",
      "交银施罗德基金管理有限公司",
    ],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "基金列表");
  return XLSX.write(workbook, { type: "buffer", bookType: "biff8" });
}

async function withTempFile(name, content, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "x-etf-transport-"));
  try {
    const filePath = path.join(directory, name);
    await fs.writeFile(filePath, content);
    return await run(filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("resolver selects the verified SSE XLS transport from OLE bytes, not the file extension", async () => {
  await withTempFile("official-export.bin", createSseXlsFixture(), async (filePath) => {
    const transport = await resolveOfficialSnapshotTransport({ ...COMMON, filePath });
    assert.equal(transport instanceof VerifiedXlsSnapshotTransport, true);

    const snapshot = await transport.readSnapshot();
    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.records.length, 1);
    assert.deepEqual(snapshot.records[0], {
      code: "510010",
      listingDate: "2009-12-15",
    });
    assert.equal(snapshot.transport.kind, "verified_xls_file");
    assert.equal(snapshot.transport.format, "xls_ole_sse_fund_list");
    assert.equal(snapshot.transport.parser, "sheetjs");
    assert.equal(snapshot.transport.parserVersion, "0.20.3");
  });
});

test("resolver preserves the generic transport for supported UTF-8 exports", async () => {
  const csv = "基金代码,上市日期\n510010,2009-12-15\n";
  await withTempFile("official-export.xls", csv, async (filePath) => {
    const transport = await resolveOfficialSnapshotTransport({ ...COMMON, filePath });
    assert.equal(transport instanceof OfficialExportFileTransport, true);
    assert.equal(transport instanceof VerifiedXlsSnapshotTransport, false);

    const snapshot = await transport.readSnapshot();
    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.transport.kind, "official_export_file");
    assert.equal(snapshot.records[0].code, "510010");
  });
});

test("resolver fails closed for an OLE export from an exchange without a verified XLS parser", async () => {
  await withTempFile("official-export.xls", createSseXlsFixture(), async (filePath) => {
    await assert.rejects(
      () => resolveOfficialSnapshotTransport({ ...COMMON, exchange: "szse", filePath }),
      /verified for exchange=sse only/
    );
  });
});
