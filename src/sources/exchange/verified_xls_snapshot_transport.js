"use strict";

const XLSX = require("xlsx");
const {
  assertEtfSnapshotTransport,
} = require("../../ports/market/etf_snapshot_transport");
const {
  isOleCompoundFile,
} = require("./official_export_probe");
const {
  OfficialExportFileTransport,
  rowsToObjects,
} = require("./official_export_file_transport");

const VERIFIED_SHEETJS_VERSION = "0.20.3";
const VERIFIED_SSE_XLS_SHEET = "基金列表";
const VERIFIED_SSE_XLS_SCHEMA = "sse_fund_list_v20260304";
const VERIFIED_SSE_XLS_HEADERS = Object.freeze([
  "基金代码",
  "基金简称",
  "基金扩位简称",
  "标的指数",
  "上市日期",
  "最新规模(亿元)",
  "基金管理人",
]);

function assertPinnedSheetJs() {
  const version = String(XLSX?.version ?? "").trim();
  if (version !== VERIFIED_SHEETJS_VERSION) {
    throw new TypeError(
      `verified SSE XLS parser requires SheetJS ${VERIFIED_SHEETJS_VERSION}, got ${version || "unknown"}.`
    );
  }
  return version;
}

function normalizedCell(value) {
  return String(value ?? "").trim();
}

function nonEmptyRows(rows) {
  if (!Array.isArray(rows)) {
    throw new TypeError("verified SSE XLS parser expected worksheet rows[].");
  }
  return rows.filter(
    (row) => Array.isArray(row) && row.some((cell) => normalizedCell(cell) !== "")
  );
}

function assertExactHeaders(row) {
  if (!Array.isArray(row)) {
    throw new TypeError("verified SSE XLS export is missing the header row.");
  }
  const actual = row.map(normalizedCell);
  if (actual.length !== VERIFIED_SSE_XLS_HEADERS.length) {
    throw new TypeError(
      `verified SSE XLS header width changed: expected ${VERIFIED_SSE_XLS_HEADERS.length}, got ${actual.length}.`
    );
  }
  for (let index = 0; index < VERIFIED_SSE_XLS_HEADERS.length; index += 1) {
    if (actual[index] !== VERIFIED_SSE_XLS_HEADERS[index]) {
      throw new TypeError(
        `verified SSE XLS header ${index + 1} changed: expected ${VERIFIED_SSE_XLS_HEADERS[index]}, got ${actual[index] || "<empty>"}.`
      );
    }
  }
  return actual;
}

function assertDataRowShape(row, index) {
  if (!Array.isArray(row)) {
    throw new TypeError(`verified SSE XLS data row ${index} must be an array.`);
  }
  if (row.length > VERIFIED_SSE_XLS_HEADERS.length) {
    throw new TypeError(
      `verified SSE XLS data row ${index} has ${row.length} columns; expected at most ${VERIFIED_SSE_XLS_HEADERS.length}.`
    );
  }
  const padded = VERIFIED_SSE_XLS_HEADERS.map((_, column) => row[column] ?? "");
  const code = normalizedCell(padded[0]);
  if (!/^\d{6}$/.test(code)) {
    throw new TypeError(`verified SSE XLS data row ${index} is missing a six-digit fund code.`);
  }
  return padded;
}

function parseVerifiedSseXls(buffer, { exchange = "sse" } = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("verified SSE XLS parser input must be a Buffer.");
  }
  if (String(exchange).trim().toLowerCase() !== "sse") {
    throw new TypeError("verified SSE XLS parser currently supports exchange=sse only.");
  }
  if (!isOleCompoundFile(buffer)) {
    throw new TypeError("verified SSE XLS parser requires an OLE Compound File export.");
  }

  const parserVersion = assertPinnedSheetJs();
  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
    });
  } catch (error) {
    throw new TypeError(
      `verified SSE XLS workbook parsing failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  if (sheetNames.length !== 1 || sheetNames[0] !== VERIFIED_SSE_XLS_SHEET) {
    throw new TypeError(
      `verified SSE XLS workbook schema changed: expected exactly one sheet named ${VERIFIED_SSE_XLS_SHEET}; got ${sheetNames.join(", ") || "none"}.`
    );
  }

  const sheet = workbook.Sheets?.[VERIFIED_SSE_XLS_SHEET];
  if (!sheet) {
    throw new TypeError(`verified SSE XLS workbook is missing sheet ${VERIFIED_SSE_XLS_SHEET}.`);
  }
  const rows = nonEmptyRows(XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }));
  if (rows.length < 2) {
    throw new TypeError("verified SSE XLS workbook must contain one header row and at least one data row.");
  }

  assertExactHeaders(rows[0]);
  const normalizedRows = [
    [...VERIFIED_SSE_XLS_HEADERS],
    ...rows.slice(1).map((row, index) => assertDataRowShape(row, index + 2)),
  ];

  return Object.freeze({
    format: "xls_ole_sse_fund_list",
    records: rowsToObjects(normalizedRows),
    parser: Object.freeze({
      name: "sheetjs",
      version: parserVersion,
      schema: VERIFIED_SSE_XLS_SCHEMA,
      sheet: VERIFIED_SSE_XLS_SHEET,
      columns: VERIFIED_SSE_XLS_HEADERS.length,
    }),
  });
}

class VerifiedXlsSnapshotTransport extends OfficialExportFileTransport {
  constructor(options = {}) {
    const exchange = String(options.exchange ?? "").trim().toLowerCase();
    if (exchange !== "sse") {
      throw new TypeError("VerifiedXlsSnapshotTransport currently supports exchange=sse only.");
    }
    super({
      ...options,
      exchange,
      parseBuffer: parseVerifiedSseXls,
    });
  }

  async readSnapshot() {
    const snapshot = await super.readSnapshot();
    return Object.freeze({
      ...snapshot,
      transport: Object.freeze({
        ...snapshot.transport,
        kind: "verified_xls_file",
        parser: "sheetjs",
        parserVersion: assertPinnedSheetJs(),
        schema: VERIFIED_SSE_XLS_SCHEMA,
        sheet: VERIFIED_SSE_XLS_SHEET,
      }),
    });
  }
}

module.exports = {
  VERIFIED_SHEETJS_VERSION,
  VERIFIED_SSE_XLS_HEADERS,
  VERIFIED_SSE_XLS_SCHEMA,
  VERIFIED_SSE_XLS_SHEET,
  VerifiedXlsSnapshotTransport,
  assertDataRowShape,
  assertExactHeaders,
  assertPinnedSheetJs,
  nonEmptyRows,
  parseVerifiedSseXls,
};
