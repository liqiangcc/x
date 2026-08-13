"use strict";

const path = require("node:path");
const {
  detectAndParse,
  sha256,
} = require("./official_export_file_transport");

const EXPORT_SIGNATURES = Object.freeze({
  EMPTY: "empty",
  XLSX_OOXML: "xlsx_ooxml",
  ZIP_CONTAINER: "zip_container",
  OLE_COMPOUND_FILE: "ole_compound_file",
  UTF8_TEXT: "utf8_text",
  BINARY_UNKNOWN: "binary_unknown",
});

function normalizeBuffer(value) {
  if (!Buffer.isBuffer(value)) {
    throw new TypeError("official export probe input must be a Buffer.");
  }
  return value;
}

function extensionHint(fileName) {
  const name = String(fileName ?? "").trim();
  if (!name) return null;
  const extension = path.extname(name).toLowerCase();
  return extension || null;
}

function isZip(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  return (buffer[2] === 0x03 && buffer[3] === 0x04)
    || (buffer[2] === 0x05 && buffer[3] === 0x06)
    || (buffer[2] === 0x07 && buffer[3] === 0x08);
}

function isOleCompoundFile(buffer) {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return buffer.length >= signature.length
    && signature.every((byte, index) => buffer[index] === byte);
}

function containsAscii(buffer, text) {
  return buffer.indexOf(Buffer.from(text, "ascii")) >= 0;
}

function isOoxmlWorkbook(buffer) {
  if (!isZip(buffer)) return false;
  return containsAscii(buffer, "[Content_Types].xml")
    && (containsAscii(buffer, "xl/workbook.xml") || containsAscii(buffer, "xl/workbook.bin"));
}

function isValidUtf8(buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function detectSignature(buffer) {
  normalizeBuffer(buffer);
  if (buffer.length === 0) return EXPORT_SIGNATURES.EMPTY;
  if (isOoxmlWorkbook(buffer)) return EXPORT_SIGNATURES.XLSX_OOXML;
  if (isZip(buffer)) return EXPORT_SIGNATURES.ZIP_CONTAINER;
  if (isOleCompoundFile(buffer)) return EXPORT_SIGNATURES.OLE_COMPOUND_FILE;
  if (isValidUtf8(buffer)) return EXPORT_SIGNATURES.UTF8_TEXT;
  return EXPORT_SIGNATURES.BINARY_UNKNOWN;
}

function recommendationFor(signature, transportSupported) {
  if (transportSupported) return "official_export_file";
  switch (signature) {
    case EXPORT_SIGNATURES.XLSX_OOXML:
      return "verified_xlsx_parser_required";
    case EXPORT_SIGNATURES.OLE_COMPOUND_FILE:
      return "verified_xls_parser_required";
    case EXPORT_SIGNATURES.ZIP_CONTAINER:
      return "unsupported_zip_container";
    case EXPORT_SIGNATURES.EMPTY:
      return "reject_empty_export";
    case EXPORT_SIGNATURES.BINARY_UNKNOWN:
      return "unsupported_binary_format";
    default:
      return "fix_or_add_verified_text_parser";
  }
}

function probeOfficialExportBuffer(buffer, { fileName = null } = {}) {
  normalizeBuffer(buffer);
  const signature = detectSignature(buffer);
  let parsed = null;
  let parserError = null;

  try {
    parsed = detectAndParse(buffer);
  } catch (error) {
    parserError = error instanceof Error ? error.message : String(error);
  }

  const transportSupported = parsed !== null;
  return Object.freeze({
    byteLength: buffer.length,
    contentHash: sha256(buffer),
    extensionHint: extensionHint(fileName),
    signature,
    transportSupported,
    parserFormat: parsed?.format ?? null,
    parserRecordCount: Array.isArray(parsed?.records) ? parsed.records.length : null,
    parserError,
    recommendation: recommendationFor(signature, transportSupported),
  });
}

module.exports = {
  EXPORT_SIGNATURES,
  detectSignature,
  extensionHint,
  isOleCompoundFile,
  isOoxmlWorkbook,
  isValidUtf8,
  isZip,
  probeOfficialExportBuffer,
  recommendationFor,
};
