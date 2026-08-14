"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildNewHighsQuery,
  buildYearlyPositiveQuery,
} = require("../src/stats/queries");

test("yearly positive query validates metric columns and binds stock code", () => {
  const query = buildYearlyPositiveQuery({
    metricColumn: "c4",
    stockCode: "000001",
  });

  assert.match(query.sql, /LAG\(c4, 1, 0\)/);
  assert.match(query.sql, /WHERE c12 = \?/);
  assert.deepEqual(query.params, ["000001"]);
  assert.equal(query.sql.includes("000001"), false);
  assert.throws(
    () => buildYearlyPositiveQuery({ metricColumn: "close" }),
    /Invalid metric column: close/
  );
});

test("new highs query keeps date and year modes deterministic", () => {
  const byDate = buildNewHighsQuery({ date: "20240102" });
  assert.match(byDate.sql, /WHERE c1 = \?/);
  assert.match(byDate.sql, /StockCode/);
  assert.deepEqual(byDate.params, ["20240102"]);

  const byYear = buildNewHighsQuery({ year: "2024" });
  assert.match(byYear.sql, /c1 AS Date, COUNT\(\*\) AS BreakoutCount/);
  assert.match(byYear.sql, /SUBSTR\(c1, 1, 4\) = \?/);
  assert.deepEqual(byYear.params, ["2024"]);

  const allYears = buildNewHighsQuery();
  assert.match(allYears.sql, /SUBSTR\(c1, 1, 4\) AS Year/);
  assert.deepEqual(allYears.params, []);
});

test("new highs query preserves mutually exclusive year/date rule", () => {
  assert.throws(
    () => buildNewHighsQuery({ year: "2024", date: "20240102" }),
    /--year and --date cannot be used together/
  );
});
