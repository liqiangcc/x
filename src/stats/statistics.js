"use strict";

const { queryDatabase } = require("../db/sqlite");

function assertMetricColumn(columnName) {
  if (!/^c\d+$/.test(columnName)) {
    throw new Error(`Invalid metric column: ${columnName}`);
  }
}

function yearlyPositivePct({ dbFile = "mydb.db", metricColumn, stockCode = null }) {
  assertMetricColumn(metricColumn);
  const whereClause = stockCode ? "WHERE c12 = ?" : "";
  const params = stockCode ? [stockCode] : [];
  const sql = `
WITH Changes AS (
  SELECT
    c1,
    CASE
      WHEN LAG(${metricColumn}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1) = 0 THEN NULL
      ELSE (${metricColumn} * 100.0 / LAG(${metricColumn}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1)) - 100.0
    END AS percentage_change
  FROM py
  ${whereClause}
)
SELECT
  SUBSTR(c1, 1, 4) AS Year,
  COUNT(percentage_change) AS TotalCount,
  COUNT(CASE WHEN percentage_change > 0 THEN 1 END) AS PositiveCount,
  COUNT(CASE WHEN percentage_change < 0 THEN 1 END) AS NegativeCount,
  COUNT(CASE WHEN percentage_change = 0 THEN 1 END) AS ZeroCount,
  printf('%.2f%%', CAST(COUNT(CASE WHEN percentage_change > 0 THEN 1 END) AS REAL) * 100 / COUNT(percentage_change)) AS PositivePercentage
FROM Changes
WHERE percentage_change IS NOT NULL
GROUP BY Year
ORDER BY Year;
`;
  return queryDatabase({ dbFile, sql, params });
}

function analyzeNewHighs({ dbFile = "mydb.db", year = null, date = null }) {
  if (year && date) {
    throw new Error("--year and --date cannot be used together.");
  }

  if (date) {
    return queryDatabase({
      dbFile,
      sql: `
WITH DailyWithPrevDay AS (
  SELECT
    c1,
    c12,
    c3,
    c13 AS prev_year_high,
    LAG(c3, 1, 0) OVER (PARTITION BY c12 ORDER BY c1) AS prev_day_c3
  FROM pd_xg
)
SELECT
  c12 AS StockCode,
  c3 AS Price,
  printf('%.2f%%', (c3 - prev_year_high) * 100.0 / prev_year_high) AS PctAboveHigh
FROM DailyWithPrevDay
WHERE c1 = ? AND c3 > prev_year_high AND prev_day_c3 <= prev_year_high AND prev_year_high > 0
ORDER BY PctAboveHigh DESC;
`,
      params: [date],
    });
  }

  const selectClause = year ? "c1 AS Date, COUNT(*) AS BreakoutCount" : "SUBSTR(c1, 1, 4) AS Year, COUNT(*) AS BreakoutCount";
  const yearFilter = year ? "AND SUBSTR(c1, 1, 4) = ?" : "";
  const groupByClause = year ? "Date" : "Year";
  const orderByClause = groupByClause;
  return queryDatabase({
    dbFile,
    sql: `
WITH Breakouts AS (
  SELECT
    c1,
    c12,
    c3,
    c13 AS prev_year_high,
    LAG(c3, 1, 0) OVER (PARTITION BY c12, SUBSTR(c1, 1, 4) ORDER BY c1) AS prev_day_c3
  FROM pd_xg
)
SELECT ${selectClause}
FROM Breakouts
WHERE c3 > prev_year_high AND prev_day_c3 <= prev_year_high AND prev_year_high > 0 ${yearFilter}
GROUP BY ${groupByClause}
ORDER BY ${orderByClause};
`,
    params: year ? [year] : [],
  });
}

module.exports = {
  analyzeNewHighs,
  yearlyPositivePct,
};
