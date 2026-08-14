"use strict";

function assertFunction(value, field) {
  if (typeof value !== "function") {
    throw new TypeError(`${field} must be a function.`);
  }
  return value;
}

function normalizeReportDate(value) {
  const date = String(value ?? "").trim();
  if (!/^\d{8}$/.test(date)) {
    throw new TypeError("date must be YYYYMMDD.");
  }
  return date;
}

class GenerateDailyReportUseCase {
  constructor({ runSignals, writeReport } = {}) {
    this.runSignals = assertFunction(runSignals, "runSignals");
    this.writeReport = assertFunction(writeReport, "writeReport");
  }

  async execute({ date } = {}) {
    const normalizedDate = normalizeReportDate(date);
    const signalReport = await this.runSignals({ date: normalizedDate });
    return this.writeReport(signalReport);
  }
}

module.exports = {
  GenerateDailyReportUseCase,
  normalizeReportDate,
};
