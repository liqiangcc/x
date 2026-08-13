"use strict";

const fs = require("node:fs/promises");
const {
  EXPORT_SIGNATURES,
  detectSignature,
} = require("./official_export_probe");
const {
  OfficialExportFileTransport,
} = require("./official_export_file_transport");
const {
  VerifiedXlsSnapshotTransport,
} = require("./verified_xls_snapshot_transport");

function normalizeExchange(value) {
  const exchange = String(value ?? "").trim().toLowerCase();
  if (!exchange) throw new TypeError("exchange is required.");
  return exchange;
}

async function resolveOfficialSnapshotTransport(options = {}, {
  readFile = fs.readFile,
} = {}) {
  if (typeof readFile !== "function") {
    throw new TypeError("readFile must be a function.");
  }

  const exchange = normalizeExchange(options.exchange);
  const filePath = String(options.filePath ?? "").trim();
  if (!filePath) throw new TypeError("filePath is required.");

  const buffer = await readFile(filePath);
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("official snapshot transport resolver expected readFile() to return a Buffer.");
  }

  const signature = detectSignature(buffer);
  if (signature === EXPORT_SIGNATURES.OLE_COMPOUND_FILE) {
    if (exchange !== "sse") {
      throw new TypeError(
        `OLE XLS official export is verified for exchange=sse only; got exchange=${exchange}.`
      );
    }
    return new VerifiedXlsSnapshotTransport({
      ...options,
      exchange,
      filePath,
    });
  }

  return new OfficialExportFileTransport({
    ...options,
    exchange,
    filePath,
  });
}

module.exports = {
  resolveOfficialSnapshotTransport,
};
