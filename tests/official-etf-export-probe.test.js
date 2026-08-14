"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EXPORT_SIGNATURES,
  detectSignature,
  probeOfficialExportBuffer,
} = require("../src/sources/exchange/official_export_probe");

function fakeOoxmlWorkbook() {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("[Content_Types].xml\0xl/workbook.xml\0", "ascii"),
  ]);
}

test("official export probe identifies supported CSV by bytes and reports parser compatibility", () => {
  const buffer = Buffer.from(
    "基金代码,上市日期\n510300,2012-05-28\n511010,2013-03-25\n",
    "utf8"
  );
  const result = probeOfficialExportBuffer(buffer, { fileName: "sse-etf-export.xls" });

  assert.equal(result.signature, EXPORT_SIGNATURES.UTF8_TEXT);
  assert.equal(result.extensionHint, ".xls");
  assert.equal(result.transportSupported, true);
  assert.equal(result.parserFormat, "csv");
  assert.equal(result.parserRecordCount, 2);
  assert.equal(result.recommendation, "official_export_file");
  assert.match(result.contentHash, /^sha256:[0-9a-f]{64}$/);
});

test("file extension never overrides the observed byte signature", () => {
  const html = Buffer.from(
    "<html><table><tr><th>基金代码</th></tr><tr><td>511010</td></tr></table></html>",
    "utf8"
  );
  const result = probeOfficialExportBuffer(html, { fileName: "download.xlsx" });

  assert.equal(result.signature, EXPORT_SIGNATURES.UTF8_TEXT);
  assert.equal(result.extensionHint, ".xlsx");
  assert.equal(result.transportSupported, true);
  assert.equal(result.parserFormat, "html_table");
});

test("probe distinguishes OOXML workbook evidence from a generic ZIP container", () => {
  const workbook = fakeOoxmlWorkbook();
  const genericZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);

  const workbookResult = probeOfficialExportBuffer(workbook, { fileName: "official.xlsx" });
  assert.equal(workbookResult.signature, EXPORT_SIGNATURES.XLSX_OOXML);
  assert.equal(workbookResult.transportSupported, false);
  assert.equal(workbookResult.recommendation, "verified_xlsx_parser_required");
  assert.match(workbookResult.parserError, /binary XLSX\/ZIP export is not supported/);

  const zipResult = probeOfficialExportBuffer(genericZip, { fileName: "official.xlsx" });
  assert.equal(zipResult.signature, EXPORT_SIGNATURES.ZIP_CONTAINER);
  assert.equal(zipResult.transportSupported, false);
  assert.equal(zipResult.recommendation, "unsupported_zip_container");
});

test("probe identifies OLE compound-file signature without claiming the payload is definitely XLS", () => {
  const ole = Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    0x00, 0x01, 0x02, 0x03,
  ]);
  const result = probeOfficialExportBuffer(ole, { fileName: "official.xls" });

  assert.equal(result.signature, EXPORT_SIGNATURES.OLE_COMPOUND_FILE);
  assert.equal(result.transportSupported, false);
  assert.equal(result.recommendation, "verified_xls_parser_required");
  assert.match(result.parserError, /binary XLS export is not supported/);
});

test("probe fails classification safely for empty and unknown binary data", () => {
  assert.equal(detectSignature(Buffer.alloc(0)), EXPORT_SIGNATURES.EMPTY);
  assert.equal(
    probeOfficialExportBuffer(Buffer.from([0xff, 0xfe, 0xfd]), { fileName: "export.dat" }).signature,
    EXPORT_SIGNATURES.BINARY_UNKNOWN
  );
});
