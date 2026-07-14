"use strict";

const { inferSecid } = require("../core/secid");
const { getKline } = require("../sources/eastmoney/client");

const DEFAULT_CN_FAST_THRESHOLD = 500;
const PERIOD_MAP = { daily: 101, yearly: 103 };

function eligibleForCnFast({ requestedEngine, selectedCodeCount, threshold }) {
  return requestedEngine === "auto"
    && Number.isInteger(selectedCodeCount)
    && Number.isInteger(threshold)
    && threshold > 0
    && selectedCodeCount < threshold;
}

async function probeLocalKline({ code, getKlineImpl = getKline, period = "daily", timeoutMs = 2000 } = {}) {
  const klt = PERIOD_MAP[period];
  if (!klt) throw new Error(`Unsupported local probe period: ${period}`);
  const payload = await getKlineImpl({
    secid: inferSecid(code),
    klt,
    lmt: 1,
    end: "20991231",
    requestOptions: { retries: 1, timeoutMs },
  });
  if (!Array.isArray(payload?.data?.klines) || payload.data.klines.length === 0) {
    throw new Error("Local Eastmoney probe returned empty klines.");
  }
  return payload;
}

async function selectStrategySyncEngine({
  codes = [],
  getKlineImpl,
  period = "daily",
  probeTimeoutMs = 2000,
  requestedEngine = "auto",
  selectedCodeCount = codes.length,
  threshold = DEFAULT_CN_FAST_THRESHOLD,
} = {}) {
  const normalizedThreshold = Number(threshold);
  const codeCount = Number(selectedCodeCount);
  const base = {
    requestedEngine,
    selectedCodeCount: codeCount,
    threshold: normalizedThreshold,
  };
  if (!eligibleForCnFast({ requestedEngine, selectedCodeCount: codeCount, threshold: normalizedThreshold })) {
    return { ...base, engine: requestedEngine, policy: null, reason: "requested_engine", localProbe: null };
  }
  if (codes.length === 0) {
    return { ...base, engine: "local", policy: null, reason: "empty_strategy_universe", localProbe: null };
  }
  const startedAt = Date.now();
  try {
    await probeLocalKline({ code: codes[0], getKlineImpl, period, timeoutMs: probeTimeoutMs });
    return {
      ...base,
      engine: "local",
      policy: null,
      reason: "local_probe_succeeded",
      localProbe: { ok: true, code: codes[0], durationMs: Date.now() - startedAt },
    };
  } catch (error) {
    return {
      ...base,
      engine: "proxy-pool",
      policy: "cn-proxy-only",
      reason: "local_probe_failed_use_cn_proxy_pool",
      localProbe: { ok: false, code: codes[0], durationMs: Date.now() - startedAt, error: error.message },
    };
  }
}

module.exports = {
  DEFAULT_CN_FAST_THRESHOLD,
  eligibleForCnFast,
  probeLocalKline,
  selectStrategySyncEngine,
};
