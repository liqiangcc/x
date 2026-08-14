"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractApiConstantSnippets,
  extractApiScript,
  extractFundlistScript,
  extractLazyLoadSources,
  extractSwingTradeValue,
  pageJavaScriptSources,
} = require("../scripts/discover_sse_etf_export");

test("SSE discovery supports the official hidden loadjs comma-separated controller list", () => {
  const html = `
    <input type="checkbox" id="SWING_TRADE" value="是">
    <div id="loadjs" style="display:none">
      /xhtml/js/fundlist.js?v=V3.1.0_20260304,/xhtml/js/lib/datepicker/WdatePicker.js
    </div>
    <script src="/xhtml/js/api.js?v=V202103-01"></script>
  `;

  assert.deepEqual(extractLazyLoadSources(html), [
    "/xhtml/js/fundlist.js?v=V3.1.0_20260304",
    "/xhtml/js/lib/datepicker/WdatePicker.js",
  ]);
  assert.equal(
    extractFundlistScript(html).url,
    "https://etf.sse.com.cn/xhtml/js/fundlist.js?v=V3.1.0_20260304"
  );
  assert.equal(
    extractApiScript(html).url,
    "https://etf.sse.com.cn/xhtml/js/api.js?v=V202103-01"
  );
  assert.equal(extractSwingTradeValue(html), "是");
  assert.deepEqual(pageJavaScriptSources(html), [
    "/xhtml/js/api.js?v=V202103-01",
    "/xhtml/js/fundlist.js?v=V3.1.0_20260304",
    "/xhtml/js/lib/datepicker/WdatePicker.js",
  ]);
});

test("SSE discovery extracts only named API constant evidence without evaluating remote JavaScript", () => {
  const apiJs = `
    var $api = {
      getFundList: apiHost + "/commonQuery.do?isPagination=true&sqlId=COMMON_JJZWZ_JJLB_L",
      exportExcelFundData_new: apiHost + "/commonSoaQuery.do?isPagination=false&sqlId=COMMON_JJZWZ_JJLB_L",
      unrelated: "ignored"
    };
  `;

  const evidence = extractApiConstantSnippets(apiJs);
  assert.equal(evidence.getFundList.length, 1);
  assert.match(evidence.getFundList[0].text, /COMMON_JJZWZ_JJLB_L/);
  assert.equal(evidence.exportExcelFundData_new.length, 1);
  assert.match(evidence.exportExcelFundData_new[0].text, /commonSoaQuery/);
  assert.deepEqual(evidence.exportExcelFundData, []);
});
