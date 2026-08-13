"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildTree,
  normalizeCategories,
  parseJsonOrJsonp,
} = require("../scripts/discover_sse_fund_categories");

test("SSE fund category discovery parses JSON and JSONP without evaluating remote code", () => {
  const payload = {
    result: [
      { CATEGORY_CODE: "F000", CATEGORY_PARENT_CODE: "-", CATEGORY_NAME: "基金" },
      { CATEGORY_CODE: "F100", CATEGORY_PARENT_CODE: "F000", CATEGORY_NAME: "ETF" },
    ],
  };
  assert.deepEqual(parseJsonOrJsonp(Buffer.from(JSON.stringify(payload))), payload);
  assert.deepEqual(
    parseJsonOrJsonp(Buffer.from(`jsonpCallback(${JSON.stringify(payload)});`)),
    payload
  );
});

test("SSE fund category discovery normalizes explicit code/name/parent facts and builds the official hierarchy", () => {
  const categories = normalizeCategories({
    result: [
      { CATEGORY_CODE: "F000", CATEGORY_PARENT_CODE: "-", CATEGORY_NAME: "基金" },
      { CATEGORY_CODE: "F100", CATEGORY_PARENT_CODE: "F000", CATEGORY_NAME: "ETF" },
      { CATEGORY_CODE: "F110", CATEGORY_PARENT_CODE: "F100", CATEGORY_NAME: "股票ETF" },
    ],
  });
  assert.deepEqual(categories, [
    { code: "F000", parentCode: "-", name: "基金" },
    { code: "F100", parentCode: "F000", name: "ETF" },
    { code: "F110", parentCode: "F100", name: "股票ETF" },
  ]);
  assert.deepEqual(buildTree(categories), [
    {
      code: "F000",
      parentCode: "-",
      name: "基金",
      children: [
        {
          code: "F100",
          parentCode: "F000",
          name: "ETF",
          children: [
            {
              code: "F110",
              parentCode: "F100",
              name: "股票ETF",
              children: [],
            },
          ],
        },
      ],
    },
  ]);
});

test("SSE fund category discovery rejects incomplete rows", () => {
  assert.throws(
    () => normalizeCategories({ result: [{ CATEGORY_CODE: "F100" }] }),
    /incomplete/
  );
});
