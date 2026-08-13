#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  fetchOfficialSse,
} = require("./sse_official_https_client");
const {
  CATEGORY_URL,
  normalizeCategories,
  parseJsonOrJsonp,
} = require("./discover_sse_fund_categories");
const {
  probeOfficialExportBuffer,
} = require("../src/sources/exchange/official_export_probe");

const PAGE_URL = "https://etf.sse.com.cn/fundlist/";
const QUERY_ORIGIN = "https://query.sse.com.cn";
const LIST_PATH = "/commonQuery.do";
const EXPORT_PATH = "/commonExcelDd.do";
const LIST_SQL_ID = "COMMON_JJZWZ_JJLB_L";
const ETF_CATEGORY = Object.freeze({ code: "F100", parentCode: "F000", name: "ETF" });
const DEFAULT_OUTPUT_DIR = "artifacts/sse-etf-export-discovery";

function requiredEtfCategory(categories) {
  const exact = categories.find((category) => category.code === ETF_CATEGORY.code);
  if (!exact) throw new TypeError(`official SSE category ${ETF_CATEGORY.code} is missing.`);
  if (exact.parentCode !== ETF_CATEGORY.parentCode || exact.name !== ETF_CATEGORY.name) {
    throw new TypeError(
      `official SSE category ${ETF_CATEGORY.code} changed: expected parent=${ETF_CATEGORY.parentCode}, name=${ETF_CATEGORY.name}; got parent=${exact.parentCode}, name=${exact.name}.`
    );
  }
  return exact;
}

function baseFilters({ swingTrade = "" } = {}) {
  return {
    FUND_CODE: "",
    COMPANY_NAME: "",
    INDEX_NAME: "",
    START_DATE: "",
    END_DATE: "",
    CATEGORY: ETF_CATEGORY.code,
    SUBCLASS: "",
    SWING_TRADE: swingTrade,
    type: "inParams",
  };
}

function buildListUrl({ swingTrade = "" } = {}) {
  const url = new URL(LIST_PATH, QUERY_ORIGIN);
  const params = new URLSearchParams({
    isPagination: "true",
    sqlId: LIST_SQL_ID,
    "pageHelp.cacheSize": "1",
    "pageHelp.pageSize": "25",
    "pageHelp.pageNo": "1",
    "pageHelp.beginPage": "1",
    "pageHelp.endPage": "1",
    ...baseFilters({ swingTrade }),
    FUND_CODE_ASC: "1",
  });
  url.search = params.toString();
  return url.href;
}

function buildExportUrl({ swingTrade = "" } = {}) {
  const url = new URL(EXPORT_PATH, QUERY_ORIGIN);
  const params = new URLSearchParams({
    isPagination: "false",
    sqlId: LIST_SQL_ID,
    ...baseFilters({ swingTrade }),
  });
  url.search = params.toString();
  return url.href;
}

function extractListEvidence(buffer) {
  const payload = parseJsonOrJsonp(buffer);
  const rows = Array.isArray(payload?.result) ? payload.result : null;
  if (!rows) throw new TypeError("SSE ETF list response must contain result[].");
  const total = Number(payload?.pageHelp?.total);
  if (!Number.isInteger(total) || total < 0) {
    throw new TypeError("SSE ETF list response pageHelp.total must be a non-negative integer.");
  }
  return Object.freeze({
    total,
    pageCount: Number(payload?.pageHelp?.pageCount ?? 0),
    returned: rows.length,
    firstCodes: Object.freeze(
      rows.slice(0, 5).map((row) => String(row?.FUND_CODE ?? "").trim()).filter(Boolean)
    ),
  });
}

function responseMeta(response, requestedUrl) {
  return Object.freeze({
    requestedUrl,
    finalUrl: response.url,
    status: response.status,
    contentType: response.contentType,
    contentDisposition: response.contentDisposition,
    byteLength: response.buffer.length,
  });
}

async function captureVariant(outputDir, { id, swingTrade }) {
  const listUrl = buildListUrl({ swingTrade });
  const listResponse = await fetchOfficialSse(listUrl, { referer: PAGE_URL });
  const listEvidence = extractListEvidence(listResponse.buffer);
  await fs.writeFile(path.join(outputDir, `${id}-list.raw`), listResponse.buffer);

  const exportUrl = buildExportUrl({ swingTrade });
  const exportResponse = await fetchOfficialSse(exportUrl, { referer: PAGE_URL });
  const exportFileName = `${id}-export.bin`;
  await fs.writeFile(path.join(outputDir, exportFileName), exportResponse.buffer);
  const probe = probeOfficialExportBuffer(exportResponse.buffer, { fileName: exportFileName });

  return Object.freeze({
    id,
    filters: Object.freeze({ category: ETF_CATEGORY.code, swingTrade }),
    expectedRecordCount: listEvidence.total,
    list: Object.freeze({
      ...responseMeta(listResponse, listUrl),
      ...listEvidence,
    }),
    export: Object.freeze({
      ...responseMeta(exportResponse, exportUrl),
      probe,
    }),
  });
}

async function main() {
  const outputDirIndex = process.argv.indexOf("--output-dir");
  const outputDir = path.resolve(
    outputDirIndex >= 0 && process.argv[outputDirIndex + 1]
      ? process.argv[outputDirIndex + 1]
      : DEFAULT_OUTPUT_DIR
  );
  await fs.mkdir(outputDir, { recursive: true });

  const categoryResponse = await fetchOfficialSse(CATEGORY_URL, { referer: PAGE_URL });
  const categories = normalizeCategories(parseJsonOrJsonp(categoryResponse.buffer));
  const category = requiredEtfCategory(categories);

  const [allEtfs, t0Etfs] = await Promise.all([
    captureVariant(outputDir, { id: "all-etfs", swingTrade: "" }),
    captureVariant(outputDir, { id: "t0-etfs", swingTrade: "是" }),
  ]);

  if (t0Etfs.expectedRecordCount > allEtfs.expectedRecordCount) {
    throw new TypeError("SSE T+0 ETF count cannot exceed the complete ETF count.");
  }

  const result = Object.freeze({
    collectedAt: new Date().toISOString(),
    category,
    contract: Object.freeze({
      listSqlId: LIST_SQL_ID,
      listEndpoint: `${QUERY_ORIGIN}${LIST_PATH}`,
      exportEndpoint: `${QUERY_ORIGIN}${EXPORT_PATH}`,
      t0Filter: "SWING_TRADE=是",
    }),
    variants: Object.freeze({ allEtfs, t0Etfs }),
  });

  await fs.writeFile(
    path.join(outputDir, "export-responses.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ETF_CATEGORY,
  EXPORT_PATH,
  LIST_PATH,
  LIST_SQL_ID,
  baseFilters,
  buildExportUrl,
  buildListUrl,
  extractListEvidence,
  requiredEtfCategory,
};
