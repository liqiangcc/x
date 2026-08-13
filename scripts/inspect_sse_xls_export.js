#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function requiredXlsx() {
  try {
    return require("xlsx");
  } catch (error) {
    throw new Error(
      "SheetJS xlsx is required for this discovery-only inspection. Install the pinned 0.20.3 package first.",
      { cause: error }
    );
  }
}

function nonEmptyRows(rows) {
  return rows.filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== ""));
}

function inspectWorkbook(filePath) {
  const XLSX = requiredXlsx();
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    dense: false,
  });
  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    throw new TypeError(`${filePath} contains no worksheets.`);
  }

  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = nonEmptyRows(XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }));
    return {
      name,
      ref: sheet?.["!ref"] ?? null,
      nonEmptyRowCount: rows.length,
      firstRows: rows.slice(0, 5),
      lastRows: rows.slice(-3),
      maxColumns: rows.reduce((max, row) => Math.max(max, row.length), 0),
    };
  });

  return {
    file: path.basename(filePath),
    byteLength: buffer.length,
    sheetCount: sheets.length,
    sheets,
  };
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0 || files.includes("--help") || files.includes("-h")) {
    process.stdout.write("Usage: node scripts/inspect_sse_xls_export.js FILE.xls [FILE2.xls ...]\n");
    return;
  }
  const reports = files.map((file) => inspectWorkbook(path.resolve(file)));
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  inspectWorkbook,
  nonEmptyRows,
};
