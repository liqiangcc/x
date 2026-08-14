"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GenerateDailyReportUseCase,
  normalizeReportDate,
} = require("../src/application/reports/generate_daily_report");

test("GenerateDailyReportUseCase orchestrates signal calculation and report writing", async () => {
  const calls = [];
  const signalReport = {
    candidates: [{ code: "600001" }],
    date: "20260701",
    isoDate: "2026-07-01",
    summary: { candidate_count: 1 },
  };
  const expected = { reportDir: "/tmp/reports/20260701" };
  const useCase = new GenerateDailyReportUseCase({
    async runSignals(input) {
      calls.push({ kind: "signals", input });
      return signalReport;
    },
    async writeReport(input) {
      calls.push({ kind: "write", input });
      return expected;
    },
  });

  const result = await useCase.execute({ date: "20260701" });

  assert.equal(result, expected);
  assert.deepEqual(calls, [
    {
      kind: "signals",
      input: { date: "20260701" },
    },
    {
      kind: "write",
      input: signalReport,
    },
  ]);
});

test("GenerateDailyReportUseCase exposes only the business request and no storage paths", async () => {
  const seen = [];
  const useCase = new GenerateDailyReportUseCase({
    async runSignals(input) {
      seen.push(input);
      return {
        candidates: [],
        date: input.date,
        isoDate: "2026-07-01",
        summary: { candidate_count: 0 },
      };
    },
    async writeReport(input) {
      seen.push(input);
      return input;
    },
  });

  await useCase.execute({ date: "20260701" });

  assert.deepEqual(seen[0], { date: "20260701" });
  assert.deepEqual(Object.keys(seen[0]), ["date"]);
  assert.equal(Object.hasOwn(seen[1], "klineDir"), false);
  assert.equal(Object.hasOwn(seen[1], "poolDir"), false);
  assert.equal(Object.hasOwn(seen[1], "outputDir"), false);
});

test("GenerateDailyReportUseCase validates its application contract before invoking dependencies", async () => {
  let called = false;
  const useCase = new GenerateDailyReportUseCase({
    async runSignals() {
      called = true;
      return {};
    },
    async writeReport() {
      called = true;
      return {};
    },
  });

  await assert.rejects(() => useCase.execute({ date: "2026-07-01" }), /YYYYMMDD/);
  await assert.rejects(() => useCase.execute({ date: "" }), /YYYYMMDD/);
  assert.equal(called, false);
});

test("GenerateDailyReportUseCase requires explicit capabilities and date normalization is deterministic", () => {
  assert.throws(() => new GenerateDailyReportUseCase(), /runSignals/);
  assert.throws(
    () => new GenerateDailyReportUseCase({ runSignals() {} }),
    /writeReport/
  );
  assert.equal(normalizeReportDate("20260701"), "20260701");
  assert.throws(() => normalizeReportDate("2026-07-01"), /YYYYMMDD/);
});
