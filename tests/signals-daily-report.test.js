"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { evaluateCapability, CapabilityType } = require("../src/signals/capabilities");
const { buildFeatures } = require("../src/signals/features");
const { runDailySignals } = require("../src/signals/daily");
const { generateDailyReport } = require("../src/reports/daily");

function klineRow(date, overrides = {}) {
  const row = {
    amount: 1000,
    close: 10,
    high: 11,
    low: 9,
    open: 10,
    volume: 100,
    ...overrides,
  };
  return [
    date,
    row.open,
    row.close,
    row.high,
    row.low,
    row.volume,
    row.amount,
    1,
    1,
    1,
    1,
  ].join(",");
}

function isoDaysEndingAt(endIsoDate, count) {
  const end = new Date(`${endIsoDate}T00:00:00.000Z`);
  const days = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(end.getTime() - index * 24 * 60 * 60 * 1000);
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

function dailyRows({ previousHigh = 11, todayAmount = 2000, todayHigh = 13 } = {}) {
  const dates = isoDaysEndingAt("2026-07-01", 65);
  return dates.map((date, index) => {
    const isToday = date === "2026-07-01";
    const isPrevious = date === "2026-06-30";
    return klineRow(date, {
      amount: isToday ? todayAmount : 1000,
      close: index + 1,
      high: isToday ? todayHigh : (isPrevious ? previousHigh : index + 2),
      low: index,
      open: index + 0.5,
    });
  });
}

function yearlyRows(date = "2025-12-30", high = 12) {
  return [klineRow(date, { close: 10, high, low: 8, open: 9 })];
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writePool(poolDir, date, pool, records) {
  await writeJson(path.join(poolDir, date, `${pool}.json`), {
    data: {
      pool: records,
      qdate: date,
    },
  });
}

async function writeKline(klineDir, period, code, klines) {
  await writeJson(path.join(klineDir, period, code.slice(0, 3), `${code}.json`), {
    code,
    market: code.startsWith("6") ? 1 : 0,
    period,
    klines,
  });
}

test("buildFeatures selects report day, previous trading day, previous yearly bar, and averages", () => {
  for (const yearlyDate of ["2025-12-29", "2025-12-30", "2025-12-31"]) {
    const built = buildFeatures({
      dailyRows: dailyRows(),
      isoDate: "2026-07-01",
      yearlyRows: yearlyRows(yearlyDate, 12),
    });

    assert.equal(built.features.today.date, "2026-07-01");
    assert.equal(built.features.previousTradingDay.date, "2026-06-30");
    assert.equal(built.features.previousYear.date, yearlyDate);
    assert.equal(built.features.previousYear.high, 12);
    assert.equal(built.features.averageAmount20, 1000);
    assert.equal(Number.isFinite(built.features.ma20), true);
    assert.equal(Number.isFinite(built.features.ma60), true);
  }
});

test("FIRST_CROSS models today-only breakout semantics", () => {
  const context = {
    features: {
      previousTradingDay: { high: 12 },
      previousYear: { high: 12 },
      today: { high: 12.5 },
    },
  };

  const params = {
    baseline: "features.previousYear.high",
    current: "features.today.high",
    previous: "features.previousTradingDay.high",
  };

  assert.equal(evaluateCapability(CapabilityType.FIRST_CROSS, context, params).ok, true);
  assert.equal(
    evaluateCapability(CapabilityType.FIRST_CROSS, {
      features: {
        previousTradingDay: { high: 12.1 },
        previousYear: { high: 12 },
        today: { high: 12.5 },
      },
    }, params).ok,
    false
  );
  assert.equal(
    evaluateCapability(CapabilityType.FIRST_CROSS, {
      features: {
        previousTradingDay: { high: 11.9 },
        previousYear: { high: 12 },
        today: { high: 12 },
      },
    }, params).ok,
    false
  );
});

test("runDailySignals scores candidates with evidence and stable sorting", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-signals-"));
  const poolDir = path.join(root, "pool");
  const klineDir = path.join(root, "kline");
  const date = "20260701";

  try {
    await writePool(poolDir, date, "zt", [
      { c: "600001", m: 1, n: "Alpha" },
      { c: "600002", m: 1, n: "Beta" },
    ]);
    await writePool(poolDir, date, "qs", [{ c: "600001", m: 1, n: "Alpha" }]);
    await writePool(poolDir, date, "zb", []);

    await writeKline(klineDir, "daily", "600001", dailyRows());
    await writeKline(klineDir, "yearly", "600001", yearlyRows("2025-12-30", 12));
    await writeKline(klineDir, "daily", "600002", dailyRows({ previousHigh: 12.5, todayHigh: 13 }));
    await writeKline(klineDir, "yearly", "600002", yearlyRows("2025-12-30", 12));

    const report = await runDailySignals({ date, klineDir, poolDir });
    assert.equal(report.candidates.length, 2);
    assert.equal(report.candidates[0].code, "600001");
    assert.equal(report.candidates[0].score, 140);
    assert.deepEqual(
      report.candidates[0].signals.map((signal) => signal.id),
      ["limit_up_pool", "strong_pool", "year_breakout", "volume_expand", "trend_confirmed"]
    );
    assert.equal(report.candidates[0].signals.find((signal) => signal.id === "year_breakout").evidence.previous_year_high, 12);
    assert.equal(report.candidates[1].signals.some((signal) => signal.id === "year_breakout"), false);
    assert.equal(report.summary.status, "ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("generateDailyReport writes deterministic report artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-report-"));
  const poolDir = path.join(root, "pool");
  const klineDir = path.join(root, "kline");
  const outputDir = path.join(root, "reports");
  const date = "20260701";

  try {
    await writePool(poolDir, date, "zt", [{ c: "600001", m: 1, n: "Alpha, Inc" }]);
    await writePool(poolDir, date, "qs", []);
    await writePool(poolDir, date, "zb", []);
    await writeKline(klineDir, "daily", "600001", dailyRows());
    await writeKline(klineDir, "yearly", "600001", yearlyRows("2025-12-31", 12));

    const result = await generateDailyReport({ date, klineDir, outputDir, poolDir });
    const reportDir = path.join(outputDir, date);
    const csv = await fs.readFile(path.join(reportDir, "candidates.csv"), "utf8");
    const candidatesJson = JSON.parse(await fs.readFile(path.join(reportDir, "candidates.json"), "utf8"));
    const summary = await fs.readFile(path.join(reportDir, "summary.md"), "utf8");
    const quality = JSON.parse(await fs.readFile(path.join(reportDir, "quality.json"), "utf8"));

    assert.equal(result.reportDir, reportDir);
    assert.match(csv, /^rank,date,code,name,market,score,pools,signals,data_quality,reason\n/);
    assert.match(csv, /"Alpha, Inc"/);
    assert.equal(candidatesJson.candidates[0].signals.some((signal) => signal.id === "year_breakout"), true);
    assert.match(summary, /# 20260701 Daily Candidates/);
    assert.equal(quality.status, "ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
