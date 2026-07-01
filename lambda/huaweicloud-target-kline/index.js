"use strict";

const http = require("node:http");
const https = require("node:https");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_EASTMONEY_BASE_URL = "http://push2his.eastmoney.com/api/qt/stock/kline/get";
const DEFAULT_EASTMONEY_RETRIES = 3;
const DEFAULT_EASTMONEY_TIMEOUT_MS = 5000;
const VALID_KLTS = new Set([101, 106]);

function nowMs() {
  return Date.now();
}

function invalidRequest(message) {
  const error = new Error(message);
  error.errorClass = "invalid_request";
  return error;
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw invalidRequest(`${name} must be a positive integer.`);
  }
  return number;
}

function normalizeTargetInput(event = {}) {
  const payload = typeof event.body === "string" ? JSON.parse(event.body) : event;
  const secid = String(payload && payload.secid ? payload.secid : "").trim();
  if (!/^[01]\.\d{6}$/.test(secid)) {
    throw invalidRequest("secid must match 0.xxxxxx or 1.xxxxxx.");
  }

  const klt = Number(payload.klt);
  if (!VALID_KLTS.has(klt)) {
    throw invalidRequest("klt must be 101 or 106.");
  }

  const lmt = parsePositiveInteger(payload.lmt, 100000, "lmt");
  const end = String(payload.end || "20991231").trim();
  if (!/^\d{8}$/.test(end)) {
    throw invalidRequest("end must be YYYYMMDD.");
  }

  return { secid, klt, lmt, end };
}

function buildEastmoneyKlineUrl(input, baseUrl = DEFAULT_EASTMONEY_BASE_URL) {
  const url = new URL(baseUrl);
  url.searchParams.set("secid", input.secid);
  url.searchParams.set("ut", "fa5fd1943c7b386f172d6893dbfba10b");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  url.searchParams.set("klt", String(input.klt));
  url.searchParams.set("fqt", "1");
  url.searchParams.set("iscca", "1");
  url.searchParams.set("end", input.end);
  url.searchParams.set("lmt", String(input.lmt));
  url.searchParams.set("_", String(nowMs()));
  return url.toString();
}

function defaultHeaders() {
  return {
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    Connection: "close",
    Referer: "https://quote.eastmoney.com/",
    "User-Agent": USER_AGENT,
  };
}

function parseJsonOrJsonp(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    throw new Error("Empty response from Eastmoney.");
  }
  const jsonMatch = trimmed.match(/^[\w$]+\((.*)\);?$/s);
  return JSON.parse(jsonMatch ? jsonMatch[1] : trimmed);
}

function requestText(urlText, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(url, {
      agent: false,
      headers: defaultHeaders(),
      method: "GET",
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Eastmoney HTTP ${response.statusCode}: ${text.slice(0, 200)}`));
          return;
        }
        resolve(text);
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("Eastmoney request timeout."));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_EASTMONEY_TIMEOUT_MS;
  const retries = options.retries || DEFAULT_EASTMONEY_RETRIES;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await requestText(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => {
          setTimeout(resolve, attempt * 300);
        });
      }
    }
  }
  throw lastError;
}

function classifyError(error) {
  const message = String(error && error.message ? error.message : error || "");
  const causeText = `${error && error.cause && error.cause.code ? error.cause.code : ""} ${
    error && error.cause && error.cause.message ? error.cause.message : ""
  }`;
  if (error && error.errorClass) {
    return error.errorClass;
  }
  if (/abort|timeout|timed out/i.test(`${message} ${causeText}`)) {
    return "timeout";
  }
  if (/UND_ERR_SOCKET|other side closed|socket hang up|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED/i.test(`${message} ${causeText}`)) {
    return "transient_network";
  }
  if (/invalid/i.test(message)) {
    return "invalid_request";
  }
  return "upstream";
}

function formatError(error) {
  const message = error && error.message ? error.message : String(error);
  const causeCode = error && error.cause && error.cause.code;
  const causeMessage = error && error.cause && error.cause.message;
  if (causeCode || causeMessage) {
    return `${message} (${[causeCode, causeMessage].filter(Boolean).join(": ")})`;
  }
  return message;
}

function normalizeEastmoneyPayload(payload, secid) {
  if (Array.isArray(payload && payload.data && payload.data.klines)) {
    return payload.data;
  }

  if (Array.isArray(payload && payload.data)) {
    const parts = secid.split(".");
    return {
      code: parts[1],
      market: Number(parts[0]),
      klines: payload.data.map((item) =>
        [
          item.f51,
          item.f52,
          item.f53,
          item.f54,
          item.f55,
          item.f56,
          item.f57,
          item.f58,
          item.f59,
          item.f60,
          item.f61,
        ].join(",")
      ),
    };
  }

  return payload && payload.data ? payload.data : null;
}

async function handleTargetKline(event, context) {
  const startedAt = nowMs();
  const sourceRegion = process.env.HUAWEICLOUD_REGION || process.env.FGS_REGION || "cn-east-3";
  try {
    if (process.env.ENABLE_DEBUG_URL === "1" && event && event.debug_url) {
      const rawText = await requestText(String(event.debug_url), DEFAULT_EASTMONEY_TIMEOUT_MS);
      return {
        ok: true,
        source_engine: "huaweicloud-functiongraph-target",
        source_region: sourceRegion,
        request_id: context && context.requestId ? context.requestId : null,
        target_duration_ms: nowMs() - startedAt,
        debug_url: event.debug_url,
        bytes: Buffer.byteLength(rawText),
        preview: rawText.slice(0, 200),
      };
    }

    const input = normalizeTargetInput(event);
    const eastmoneyStartedAt = nowMs();
    const rawText = await fetchWithTimeout(buildEastmoneyKlineUrl(input), {
      timeoutMs: Number(process.env.EASTMONEY_TIMEOUT_MS || DEFAULT_EASTMONEY_TIMEOUT_MS),
      retries: Number(process.env.EASTMONEY_RETRIES || DEFAULT_EASTMONEY_RETRIES),
    });
    const eastmoneyDurationMs = nowMs() - eastmoneyStartedAt;
    const rawPayload = parseJsonOrJsonp(rawText);
    const data = normalizeEastmoneyPayload(rawPayload, input.secid);
    if (!Array.isArray(data && data.klines)) {
      throw new Error("Eastmoney response missing data.klines.");
    }

    return {
      ok: true,
      source_engine: "huaweicloud-functiongraph-target",
      source_region: sourceRegion,
      request_id: context && context.requestId ? context.requestId : null,
      target_duration_ms: nowMs() - startedAt,
      eastmoney_duration_ms: eastmoneyDurationMs,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      error: formatError(error),
      source_engine: "huaweicloud-functiongraph-target",
      source_region: sourceRegion,
      request_id: context && context.requestId ? context.requestId : null,
      target_duration_ms: nowMs() - startedAt,
      error_class: classifyError(error),
    };
  }
}

module.exports = {
  handler: handleTargetKline,
};
