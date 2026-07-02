"use strict";

const MASKED = "[masked]";
const SENSITIVE_KEY_PATTERN = /(^|_)(authorization|api_?key|access_?key|secret_?key|token|secret|password|key)($|_)/i;

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function isFalsy(value) {
  return ["0", "false", "no", "off"].includes(String(value ?? "").trim().toLowerCase());
}

function isStageLogEnabled(env = process.env) {
  if (isFalsy(env.X_STAGE_LOG)) {
    return false;
  }
  return isTruthy(env.X_STAGE_LOG) || String(env.GITHUB_ACTIONS ?? "").toLowerCase() === "true";
}

function sanitizeStageDetails(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStageDetails(item, seen));
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? MASKED : sanitizeStageDetails(item, seen);
  }
  return output;
}

function formatStageLog(event, name, details = {}, now = new Date()) {
  const safeEvent = String(event ?? "").trim() || "event";
  const safeName = String(name ?? "").trim() || "stage";
  const safeDetails = sanitizeStageDetails(details ?? {});
  return `[stage] ${now.toISOString()} ${safeEvent} ${safeName} ${JSON.stringify(safeDetails)}`;
}

function stageLog(event, name, details = {}, options = {}) {
  const env = options.env ?? process.env;
  if (!isStageLogEnabled(env)) {
    return;
  }
  const writer = options.writer ?? process.stderr;
  writer.write(`${formatStageLog(event, name, details, options.now ?? new Date())}\n`);
}

async function withStage(name, details, fn, options = {}) {
  const startedAt = Date.now();
  stageLog("start", name, details, options);
  try {
    const result = await fn();
    stageLog("end", name, { ...details, duration_ms: Date.now() - startedAt }, options);
    return result;
  } catch (error) {
    stageLog("error", name, {
      ...details,
      duration_ms: Date.now() - startedAt,
      error: error?.message ?? String(error),
    }, options);
    throw error;
  }
}

function startStageHeartbeat(name, detailsFn, options = {}) {
  const env = options.env ?? process.env;
  if (!isStageLogEnabled(env)) {
    return () => {};
  }
  const intervalMs = options.intervalMs ?? 30000;
  const timer = setInterval(() => {
    let details = {};
    try {
      details = detailsFn();
    } catch (error) {
      details = { error: error?.message ?? String(error) };
    }
    stageLog("heartbeat", name, details, options);
  }, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return () => {
    clearInterval(timer);
  };
}

module.exports = {
  formatStageLog,
  isStageLogEnabled,
  sanitizeStageDetails,
  stageLog,
  startStageHeartbeat,
  withStage,
};
