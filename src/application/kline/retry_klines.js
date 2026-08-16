"use strict";

const path = require("node:path");

function assertFunction(value, field) {
  if (typeof value !== "function") {
    throw new TypeError(`${field} must be a function.`);
  }
  return value;
}

function extractRetryCodes(payload = {}) {
  if (Array.isArray(payload.codes)) {
    return [...new Set(payload.codes.map(String).filter(Boolean))].sort();
  }

  if (payload.files && typeof payload.files === "object") {
    return Object.entries(payload.files)
      .filter(([, item]) => item?.status === "failed")
      .map(([code, item]) => item?.code ?? code)
      .filter(Boolean)
      .sort();
  }

  if (Array.isArray(payload.items)) {
    return [...new Set(payload.items
      .map((item) => item?.code ?? item?.target)
      .filter(Boolean)
      .map((value) => String(value).includes(".") ? String(value).split(".")[1] : String(value))
    )].sort();
  }

  return [];
}

function inferKlineRetryPeriod(payload = {}, requestedPeriod = null) {
  const itemPeriod = Array.isArray(payload.items)
    ? payload.items.find((item) => item?.period)?.period
    : null;
  return requestedPeriod ?? payload.period ?? itemPeriod ?? "daily";
}

function inferKlineOutputDirFromSummary(summaryPath, period) {
  const resolved = path.resolve(summaryPath);
  if (path.basename(resolved) === `summary.${period}.json`) {
    return path.dirname(path.dirname(resolved));
  }
  return "data/kline";
}

function buildKlineRetryPlan({ inputPath, payload, options = {} } = {}) {
  if (!inputPath) {
    throw new Error("kline retry requires <summary.json|failures.json>");
  }

  const codes = extractRetryCodes(payload);
  if (codes.length === 0) {
    throw new Error("No failed kline codes found to retry.");
  }

  const period = inferKlineRetryPeriod(payload, options.period);
  return {
    codes,
    engine: options.engine ?? "aws",
    outputDir: options.outputDir ?? inferKlineOutputDirFromSummary(inputPath, period),
    period,
    syncOptions: {
      ...options,
      concurrency: options.concurrency ?? 1,
      limit: null,
      outputDir: null,
      period,
      retryAttempts: options.retryAttempts ?? 3,
      retryConcurrency: options.retryConcurrency ?? 1,
    },
  };
}

function assertRetryCodesInput(value) {
  if (!value || typeof value.path !== "string" || typeof value.cleanup !== "function") {
    throw new TypeError("createRetryCodesInput must return { path, cleanup }.");
  }
  return value;
}

class RetryKlinesUseCase {
  constructor({ readRetryArtifact, createRetryCodesInput, runKlineSync } = {}) {
    this.readRetryArtifact = assertFunction(readRetryArtifact, "readRetryArtifact");
    this.createRetryCodesInput = assertFunction(createRetryCodesInput, "createRetryCodesInput");
    this.runKlineSync = assertFunction(runKlineSync, "runKlineSync");
  }

  async execute({ inputPath, options = {} } = {}) {
    if (!inputPath) {
      throw new Error("kline retry requires <summary.json|failures.json>");
    }

    const payload = await this.readRetryArtifact(inputPath);
    const plan = buildKlineRetryPlan({ inputPath, payload, options });
    const retryCodesInput = assertRetryCodesInput(await this.createRetryCodesInput(plan.codes));

    try {
      const result = await this.runKlineSync({
        engine: plan.engine,
        inputPath: retryCodesInput.path,
        options: plan.syncOptions,
        outputDir: plan.outputDir,
        period: plan.period,
      });
      return {
        ...plan,
        result,
      };
    } finally {
      await retryCodesInput.cleanup();
    }
  }
}

module.exports = {
  RetryKlinesUseCase,
  buildKlineRetryPlan,
  extractRetryCodes,
  inferKlineOutputDirFromSummary,
  inferKlineRetryPeriod,
};
