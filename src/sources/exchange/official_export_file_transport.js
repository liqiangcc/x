"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  normalizeCollectedAt,
} = require("../../market/security_master_record");
const {
  assertOfficialExchangeDocument,
  normalizeOfficialExchange,
} = require("../../market/official_exchange_provenance");
const {
  assertEtfSnapshotTransport,
} = require("../../ports/market/etf_snapshot_transport");

const ETF_SNAPSHOT_DATASETS = Object.freeze({
  ALL_ETFS: "all_etfs",
  T0_ETFS: "t0_etfs",
});
const SUPPORTED_DATASETS = Object.freeze(Object.values(ETF_SNAPSHOT_DATASETS));

const FIELD_ALIASES = Object.freeze({
  code: Object.freeze(["基金代码", "证券代码", "代码", "fundcode", "securitycode", "code"]),
  listingDate: Object.freeze(["上市日期", "上市时间", "上市日", "listingdate", "effectivefrom"]),
});

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function normalizeDataset(value) {
  const dataset = String(value ?? "").trim().toLowerCase();
  if (!SUPPORTED_DATASETS.includes(dataset)) {
    throw new TypeError(`dataset must be one of: ${SUPPORTED_DATASETS.join(", ")}.`);
  }
  return dataset;
}

function normalizeExpectedCount(value, dataset) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new TypeError("expectedRecordCount must be a non-negative integer.");
  }
  if (dataset === ETF_SNAPSHOT_DATASETS.ALL_ETFS && count === 0) {
    throw new TypeError("all_etfs expectedRecordCount must be greater than zero.");
  }
  return count;
}

function normalizeContentHash(value, { nullable = true } = {}) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = requiredText(value, "expectedContentHash").toLowerCase();
  const normalized = text.startsWith("sha256:") ? text : `sha256:${text}`;
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError("expectedContentHash must be a SHA-256 hex digest.");
  }
  return normalized;
}

function sha256(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => String(value).trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new TypeError("export file contains an unterminated quoted field.");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => String(value).trim() !== "")) rows.push(row);
  return rows;
}

function parseHtmlRows(text) {
  const rows = [];
  const rowMatches = text.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const rowText of rowMatches) {
    const cells = [];
    const cellPattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let match;
    while ((match = cellPattern.exec(rowText)) !== null) {
      cells.push(decodeHtml(match[1]));
    }
    if (cells.some((value) => value !== "")) rows.push(cells);
  }
  if (rows.length === 0) throw new TypeError("HTML export does not contain a readable table.");
  return rows;
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 1) {
    throw new TypeError("export file does not contain a header row.");
  }
  const headers = rows[0].map(normalizeHeader);
  if (headers.every((header) => header === "")) {
    throw new TypeError("export file header row is empty.");
  }
  return rows.slice(1).map((row) => {
    const result = {};
    headers.forEach((header, index) => {
      if (header) result[header] = row[index] ?? "";
    });
    return result;
  });
}

function parseJsonRecords(text) {
  const payload = JSON.parse(text);
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.records)) {
    return payload.records;
  }
  throw new TypeError("JSON export must be an array or an object with records[].");
}

function detectAndParse(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    throw new TypeError(
      "binary XLSX/ZIP export is not supported by the verified file transport; convert the official export to UTF-8 CSV/TSV or use a dedicated verified XLSX parser."
    );
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0
  ) {
    throw new TypeError(
      "binary XLS export is not supported by the verified file transport; convert the official export to UTF-8 CSV/TSV or use a dedicated verified XLS parser."
    );
  }

  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const trimmed = text.trim();
  if (!trimmed) throw new TypeError("official export file is empty.");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { format: "json", records: parseJsonRecords(trimmed) };
  }
  if (/<table\b/i.test(trimmed)) {
    return { format: "html_table", records: rowsToObjects(parseHtmlRows(trimmed)) };
  }
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  const delimiter = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
    ? "\t"
    : ",";
  return {
    format: delimiter === "\t" ? "tsv" : "csv",
    records: rowsToObjects(parseDelimitedRows(trimmed, delimiter)),
  };
}

function valueByAliases(record, aliases) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("export record must be an object.");
  }
  const normalized = new Map(
    Object.entries(record).map(([key, value]) => [normalizeHeader(key), value])
  );
  for (const alias of aliases) {
    if (normalized.has(alias)) return normalized.get(alias);
  }
  return undefined;
}

function normalizeExportRecord(record, dataset, index) {
  const code = String(valueByAliases(record, FIELD_ALIASES.code) ?? "")
    .replace(/\s+/g, "")
    .trim();
  if (!/^\d{6}$/.test(code)) {
    throw new TypeError(`export record ${index} is missing a six-digit ETF code.`);
  }
  if (dataset === ETF_SNAPSHOT_DATASETS.T0_ETFS) {
    return Object.freeze({ code });
  }
  const listingDate = requiredText(
    valueByAliases(record, FIELD_ALIASES.listingDate),
    `export record ${index} listing date`
  );
  return Object.freeze({ code, listingDate });
}

class OfficialExportFileTransport {
  constructor({
    exchange,
    dataset,
    filePath,
    document,
    version,
    collectedAt,
    expectedRecordCount,
    expectedContentHash = null,
  } = {}) {
    this.exchange = normalizeOfficialExchange(exchange);
    this.dataset = normalizeDataset(dataset);
    this.filePath = path.resolve(requiredText(filePath, "filePath"));
    this.document = assertOfficialExchangeDocument(this.exchange, document, "document");
    this.version = requiredText(version, "version");
    this.collectedAt = normalizeCollectedAt(collectedAt);
    this.expectedRecordCount = normalizeExpectedCount(expectedRecordCount, this.dataset);
    this.expectedContentHash = normalizeContentHash(expectedContentHash);
  }

  async readSnapshot() {
    const buffer = await fs.readFile(this.filePath);
    const contentHash = sha256(buffer);
    if (this.expectedContentHash !== null && contentHash !== this.expectedContentHash) {
      throw new TypeError(
        `official export content hash mismatch: expected ${this.expectedContentHash}, got ${contentHash}.`
      );
    }

    const parsed = detectAndParse(buffer);
    const records = parsed.records.map((record, index) =>
      normalizeExportRecord(record, this.dataset, index)
    );
    if (records.length !== this.expectedRecordCount) {
      throw new TypeError(
        `official export record count mismatch: expected ${this.expectedRecordCount}, got ${records.length}.`
      );
    }

    return Object.freeze({
      complete: true,
      records: Object.freeze(records),
      source: Object.freeze({
        document: this.document,
        version: this.version,
        collectedAt: this.collectedAt,
        contentHash,
      }),
      transport: Object.freeze({
        kind: "official_export_file",
        exchange: this.exchange,
        dataset: this.dataset,
        format: parsed.format,
        expectedRecordCount: this.expectedRecordCount,
        actualRecordCount: records.length,
        contentHash,
      }),
    });
  }
}

assertEtfSnapshotTransport(new OfficialExportFileTransport({
  exchange: "sse",
  dataset: "all_etfs",
  filePath: "__missing__.csv",
  document: "https://etf.sse.com.cn/fundlist/",
  version: "test",
  collectedAt: "2026-08-13T00:00:00Z",
  expectedRecordCount: 1,
}));

module.exports = {
  ETF_SNAPSHOT_DATASETS,
  FIELD_ALIASES,
  OfficialExportFileTransport,
  SUPPORTED_DATASETS,
  detectAndParse,
  normalizeContentHash,
  normalizeDataset,
  normalizeExportRecord,
  parseDelimitedRows,
  parseHtmlRows,
  rowsToObjects,
  sha256,
};
