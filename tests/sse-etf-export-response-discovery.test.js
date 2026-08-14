"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ETF_CATEGORY,
  buildExportUrl,
  buildListUrl,
  extractListEvidence,
  requiredEtfCategory,
} = require("../scripts/discover_sse_etf_export_response");

test("SSE ETF export discovery requires the exact official F100 ETF category contract", () => {
  assert.deepEqual(
    requiredEtfCategory([
      { code: "F000", parentCode: "-", name: "基金" },
      { code: "F100", parentCode: "F000", name: "ETF" },
    ]),
    ETF_CATEGORY
  );
  assert.throws(
    () => requiredEtfCategory([{ code: "F100", parentCode: "F000", name: "LOF" }]),
    /changed/
  );
});

test("SSE ETF export discovery builds explicit all-ETF and T+0 request parameters", () => {
  const allList = new URL(buildListUrl({ swingTrade: "" }));
  assert.equal(allList.origin, "https://query.sse.com.cn");
  assert.equal(allList.pathname, "/commonQuery.do");
  assert.equal(allList.searchParams.get("sqlId"), "COMMON_JJZWZ_JJLB_L");
  assert.equal(allList.searchParams.get("CATEGORY"), "F100");
  assert.equal(allList.searchParams.get("SWING_TRADE"), "");
  assert.equal(allList.searchParams.get("pageHelp.pageSize"), "25");

  const t0Export = new URL(buildExportUrl({ swingTrade: "是" }));
  assert.equal(t0Export.origin, "https://query.sse.com.cn");
  assert.equal(t0Export.pathname, "/commonExcelDd.do");
  assert.equal(t0Export.searchParams.get("isPagination"), "false");
  assert.equal(t0Export.searchParams.get("CATEGORY"), "F100");
  assert.equal(t0Export.searchParams.get("SWING_TRADE"), "是");
  assert.equal(t0Export.searchParams.get("type"), "inParams");
});

test("SSE ETF list evidence uses the official pagination total as expected export count", () => {
  const payload = Buffer.from(JSON.stringify({
    pageHelp: { total: 321, pageCount: 13 },
    result: [
      { FUND_CODE: "510300" },
      { FUND_CODE: "511010" },
    ],
  }));
  assert.deepEqual(extractListEvidence(payload), {
    total: 321,
    pageCount: 13,
    returned: 2,
    firstCodes: ["510300", "511010"],
  });
});
