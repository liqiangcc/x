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

function yearlyRows(date = "2025-12-30", high = 12, options = {}) {
  const completedCloses = options.completedCloses ?? [14, 12, 10, 8, 6];
  const startYear = 2026 - completedCloses.length;
  const rows = completedCloses.map((close, index) => {
    const year = startYear + index;
    const rowDate = year === 2025 ? date : `${year}-12-31`;
    return klineRow(rowDate, {
      close,
      high: year === 2025 ? high : close + 2,
      low: close - 1,
      open: close + 1,
    });
  });

  if (options.includeCurrent !== false) {
    rows.push(klineRow("2026-06-30", {
      close: options.currentClose ?? 5,
      high: options.currentHigh ?? 6,
      low: options.currentLow ?? 1,
      open: options.currentOpen ?? 1,
    }));
  }

  return rows;
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
    assert.equal(built.features.completedYears.length, 5);
    assert.equal(built.features.completedYears.at(-1).year, 2025);
    assert.equal(built.features.currentYear.open, 1);
    assert.equal(built.features.currentYear.open_source, "yearly");
    assert.equal(built.features.averageAmount20, 1000);
    assert.equal(Number.isFinite(built.features.ma20), true);
    assert.equal(Number.isFinite(built.features.ma60), true);
  }
});

test("buildFeatures falls back current year open to daily rows", () => {
  const built = buildFeatures({
    dailyRows: dailyRows(),
    isoDate: "2026-07-01",
    yearlyRows: yearlyRows("2025-12-30", 12, { includeCurrent: false }),
  });

  assert.equal(built.features.currentYear.open_source, "daily");
  assert.equal(Number.isFinite(built.features.currentYear.open), true);
  assert.equal(built.issues.includes("missing_current_year_open"), false);
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

test("VALUE_COMPARE supports configurable operators", () => {
  const context = {
    features: {
      left: 12,
      right: 10,
    },
  };

  assert.equal(evaluateCapability(CapabilityType.VALUE_COMPARE, context, {
    left: "features.left",
    operator: "gt",
    right: "features.right",
  }).ok, true);
  assert.equal(evaluateCapability(CapabilityType.VALUE_COMPARE, context, {
    left: "features.left",
    operator: "lte",
    right: "features.right",
  }).ok, false);
  assert.equal(evaluateCapability(CapabilityType.VALUE_COMPARE, context, {
    left: "features.missing",
    operator: "gt",
    qualityIssue: "missing_value",
    right: "features.right",
  }).qualityIssues[0], "missing_value");
});

test("SEQUENCE_PATTERN is fully parameterized", () => {
  const context = {
    features: {
      years: [
        { close: 14, high: 20, year: 2021 },
        { close: 12, high: 18, year: 2022 },
        { close: 10, high: 16, year: 2023 },
        { close: 8, high: 14, year: 2024 },
        { close: 6, high: 12, year: 2025 },
      ],
    },
  };

  assert.equal(evaluateCapability(CapabilityType.SEQUENCE_PATTERN, context, {
    comparator: "lt",
    field: "close",
    order: "latest",
    source: "features.years",
    transitions: 3,
  }).ok, true);
  assert.equal(evaluateCapability(CapabilityType.SEQUENCE_PATTERN, context, {
    comparator: "lt",
    field: "high",
    order: "earliest",
    source: "features.years",
    transitions: 2,
  }).ok, true);
  assert.equal(evaluateCapability(CapabilityType.SEQUENCE_PATTERN, {
    features: {
      years: [
        { close: 1, year: 2021 },
        { close: 2, year: 2022 },
        { close: 3, year: 2023 },
      ],
    },
  }, {
    comparator: "gt",
    field: "close",
    order: "latest",
    source: "features.years",
    transitions: 2,
  }).ok, true);
  assert.equal(evaluateCapability(CapabilityType.SEQUENCE_PATTERN, {
    features: {
      years: [
        { close: 3, year: 2021 },
        { close: 2, year: 2022 },
        { close: 2, year: 2023 },
        { close: 1, year: 2024 },
      ],
    },
  }, {
    comparator: "lt",
    field: "close",
    order: "latest",
    source: "features.years",
    transitions: 3,
  }).ok, false);
  assert.deepEqual(evaluateCapability(CapabilityType.SEQUENCE_PATTERN, {
    features: {
      years: [{ close: 3, year: 2023 }],
    },
  }, {
    comparator: "lt",
    field: "close",
    order: "latest",
    qualityIssue: "insufficient_yearly_history",
    source: "features.years",
    transitions: 3,
  }).qualityIssues, ["insufficient_yearly_history"]);
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
    assert.equal(report.candidates[0].score, 160);
    assert.deepEqual(
      report.candidates[0].signals.map((signal) => signal.id),
      ["limit_up_pool", "strong_pool", "year_breakout", "year_downtrend_reversal", "volume_expand", "trend_confirmed"]
    );
    assert.equal(report.candidates[0].signals.find((signal) => signal.id === "year_breakout").evidence.previous_year_high, 12);
    assert.equal(
      report.candidates[0].signals.find((signal) => signal.id === "year_downtrend_reversal").evidence.required_down_transitions,
      3
    );
    assert.equal(report.candidates[1].signals.some((signal) => signal.id === "year_breakout"), false);
    assert.equal(report.summary.status, "ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("year_downtrend_reversal requires configured down sequence and current-year gain", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-reversal-"));
  const poolDir = path.join(root, "pool");
  const klineDir = path.join(root, "kline");
  const date = "20260701";

  try {
    await writePool(poolDir, date, "zt", [
      { c: "600001", m: 1, n: "Alpha" },
      { c: "600002", m: 1, n: "Beta" },
      { c: "600003", m: 1, n: "Gamma" },
      { c: "600004", m: 1, n: "Delta" },
    ]);
    await writePool(poolDir, date, "qs", []);
    await writePool(poolDir, date, "zb", []);

    for (const code of ["600001", "600002", "600003", "600004"]) {
      await writeKline(klineDir, "daily", code, dailyRows());
    }
    await writeKline(klineDir, "yearly", "600001", yearlyRows("2025-12-30", 12));
    await writeKline(klineDir, "yearly", "600002", yearlyRows("2025-12-30", 12, {
      completedCloses: [14, 12, 13, 8, 6],
    }));
    await writeKline(klineDir, "yearly", "600003", yearlyRows("2025-12-30", 12, {
      currentOpen: 100,
    }));
    await writeKline(klineDir, "yearly", "600004", yearlyRows("2025-12-30", 12, {
      completedCloses: [6],
    }));

    const report = await runDailySignals({ date, klineDir, poolDir });
    const byCode = new Map(report.candidates.map((candidate) => [candidate.code, candidate]));
    const signalIds = (code) => new Set(byCode.get(code).signals.map((signal) => signal.id));

    assert.equal(signalIds("600001").has("year_downtrend_reversal"), true);
    assert.equal(signalIds("600002").has("year_downtrend_reversal"), false);
    assert.equal(signalIds("600003").has("year_downtrend_reversal"), false);
    assert.equal(signalIds("600004").has("year_downtrend_reversal"), false);
    assert.equal(byCode.get("600004").quality.issues.includes("insufficient_yearly_history"), true);
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
