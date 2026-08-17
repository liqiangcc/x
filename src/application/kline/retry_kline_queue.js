"use strict";

function assertFunction(value, field) {
  if (typeof value !== "function") {
    throw new TypeError(`${field} must be a function.`);
  }
  return value;
}

function normalizeExpectedLatestDate(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).replaceAll("-", "");
}

function buildRetryQueueSyncRequest({
  concurrency,
  due,
  dueFile,
  policy,
  queueFile,
} = {}) {
  if (!due || !Array.isArray(due.codes)) {
    throw new TypeError("retry queue due result must contain codes.");
  }
  if (due.codes.length === 0) return null;
  if (!due.period) {
    throw new Error("Missing value for --period");
  }

  const options = {
    concurrency: String(concurrency),
    failureQueue: queueFile,
    policy,
    retryAttempts: "0",
  };
  const expectedLatestDate = normalizeExpectedLatestDate(due.expectedLatestDate);
  if (expectedLatestDate) {
    options.expectedLatestDate = expectedLatestDate;
    options.freshnessCodes = dueFile;
  }

  return {
    inputPath: dueFile,
    options,
    period: due.period,
  };
}

class RetryKlineQueueUseCase {
  constructor({ writeDueCodes, runKlineSync } = {}) {
    this.writeDueCodes = assertFunction(writeDueCodes, "writeDueCodes");
    this.runKlineSync = assertFunction(runKlineSync, "runKlineSync");
  }

  async execute({
    concurrency = "2",
    dueFile,
    policy = "proxy-only",
    queueFile,
  } = {}) {
    if (!queueFile) {
      throw new Error("kline retry-queue requires <queue.json>.");
    }
    if (!dueFile) {
      throw new TypeError("retry queue dueFile is required.");
    }

    const due = await this.writeDueCodes(queueFile, dueFile);
    const syncRequest = buildRetryQueueSyncRequest({
      concurrency,
      due,
      dueFile,
      policy,
      queueFile,
    });

    if (!syncRequest) {
      return {
        due,
        dueCount: 0,
        dueFile,
        queueFile,
        result: null,
        status: "no_due_items",
        syncRequest: null,
      };
    }

    const result = await this.runKlineSync(syncRequest);
    return {
      due,
      dueCount: due.codes.length,
      dueFile,
      queueFile,
      result,
      status: "synced",
      syncRequest,
    };
  }
}

module.exports = {
  RetryKlineQueueUseCase,
  buildRetryQueueSyncRequest,
  normalizeExpectedLatestDate,
};
