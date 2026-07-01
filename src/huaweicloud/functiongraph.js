"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const ALGORITHM = "SDK-HMAC-SHA256";
const ACCESS_KEY_ENV = "HUAWEICLOUD_ACCESS_KEY";
const SECRET_KEY_ENV = "HUAWEICLOUD_SECRET_KEY";
const TARGETS_JSON_ENV = "HUAWEICLOUD_TARGETS_JSON";

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmacSha256Hex(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function sdkDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeHeaderValue(value) {
  return String(value).trim();
}

function canonicalQueryString(searchParams) {
  const pairs = [];
  for (const [key, value] of searchParams.entries()) {
    pairs.push([encodeRfc3986(key), encodeRfc3986(value)]);
  }
  return pairs
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function canonicalUri(pathname) {
  const encoded = String(pathname || "/")
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/");
  return encoded.endsWith("/") ? encoded : `${encoded}/`;
}

function canonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), normalizeHeaderValue(value)])
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders: entries.map(([name]) => name).join(";"),
  };
}

function buildCanonicalRequest({ method, url, headers, body }) {
  const parsedUrl = new URL(url);
  const { canonical, signedHeaders } = canonicalHeaders(headers);
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(parsedUrl.pathname),
    canonicalQueryString(parsedUrl.searchParams),
    canonical,
    signedHeaders,
    sha256Hex(body ?? ""),
  ].join("\n");
  return { canonicalRequest, signedHeaders };
}

function signRequest({ accessKey, secretKey, method, url, headers = {}, body = "", date = new Date() }) {
  if (!accessKey) {
    throw new Error(`${ACCESS_KEY_ENV} is required.`);
  }
  if (!secretKey) {
    throw new Error(`${SECRET_KEY_ENV} is required.`);
  }

  const parsedUrl = new URL(url);
  const requestDate = sdkDate(date);
  const requestHeaders = {
    ...headers,
    Host: parsedUrl.host,
    "X-Sdk-Date": requestDate,
  };
  const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method,
    url,
    headers: requestHeaders,
    body,
  });
  const stringToSign = [
    ALGORITHM,
    requestDate,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmacSha256Hex(secretKey, stringToSign);
  return {
    authorization: `${ALGORITHM} Access=${accessKey}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    headers: {
      ...requestHeaders,
      Authorization: `${ALGORITHM} Access=${accessKey}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    signature,
    signedHeaders,
    stringToSign,
  };
}

function endpointForRegion(region) {
  return `https://functiongraph.${region}.myhuaweicloud.com`;
}

function invokePath(projectId, functionUrn) {
  return `/v2/${encodeRfc3986(projectId)}/fgs/functions/${encodeRfc3986(functionUrn)}/invocations`;
}

function parseJsonText(rawText, label) {
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${error.message}`);
  }
}

function loadHuaweiCloudTargets({ targetsFile = null, env = process.env } = {}) {
  const rawText = targetsFile
    ? fs.readFileSync(targetsFile, "utf8")
    : String(env[TARGETS_JSON_ENV] ?? "").trim();
  if (!rawText) {
    throw new Error(`Huawei Cloud targets are required via --huaweicloud-targets or ${TARGETS_JSON_ENV}.`);
  }
  const payload = parseJsonText(rawText, "Huawei Cloud targets JSON");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Huawei Cloud targets JSON must be an object keyed by region.");
  }
  return Object.fromEntries(Object.entries(payload)
    .map(([region, target]) => [String(region).trim(), target])
    .filter(([region]) => region));
}

function normalizeHuaweiCloudTarget(region, target) {
  const projectId = String(target?.project_id ?? target?.projectId ?? "").trim();
  const functionUrn = String(target?.function_urn ?? target?.functionUrn ?? "").trim();
  if (!projectId || !functionUrn) {
    return {
      error: `Huawei Cloud target ${region} requires project_id and function_urn.`,
      ok: false,
    };
  }
  return {
    functionUrn,
    ok: true,
    projectId,
    region,
  };
}

async function invokeFunctionGraph({
  accessKey,
  secretKey,
  target,
  payload,
  fetchImpl = fetch,
  date = new Date(),
}) {
  const body = JSON.stringify(payload);
  const url = `${endpointForRegion(target.region)}${invokePath(target.projectId, target.functionUrn)}`;
  const signed = signRequest({
    accessKey,
    secretKey,
    method: "POST",
    url,
    headers: {
      "Content-Type": "application/json",
    },
    body,
    date,
  });
  const response = await fetchImpl(url, {
    method: "POST",
    headers: signed.headers,
    body,
  });
  const rawText = await response.text();
  const outerPayload = parseJsonText(rawText, "FunctionGraph response");
  if (!response.ok) {
    throw new Error(`FunctionGraph returned statusCode ${response.status}: ${outerPayload.error_msg ?? rawText}`);
  }
  if (outerPayload.error_code || outerPayload.error_msg) {
    throw new Error(`FunctionGraph returned ${outerPayload.error_code ?? "error"}: ${outerPayload.error_msg ?? rawText}`);
  }
  const resultPayload = typeof outerPayload.result === "string"
    ? parseJsonText(outerPayload.result, "FunctionGraph result")
    : outerPayload.result;
  if (outerPayload.status && Number(outerPayload.status) !== 200) {
    throw new Error(`FunctionGraph invocation status ${outerPayload.status}: ${resultPayload?.error ?? rawText}`);
  }
  return {
    outerPayload,
    requestId: outerPayload.request_id ?? null,
    resultPayload,
  };
}

module.exports = {
  ACCESS_KEY_ENV,
  SECRET_KEY_ENV,
  TARGETS_JSON_ENV,
  buildCanonicalRequest,
  endpointForRegion,
  invokeFunctionGraph,
  invokePath,
  loadHuaweiCloudTargets,
  normalizeHuaweiCloudTarget,
  signRequest,
};
