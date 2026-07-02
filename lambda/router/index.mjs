import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

const DEFAULT_TARGET_TIMEOUT_MS = 18000;
const DEFAULT_MAX_FALLBACKS = 6;
const DEFAULT_KLINE_LMT = 10000;
const VALID_KLTS = new Set([101, 106]);

function nowMs() {
  return Date.now();
}

function routerRegion(env = process.env) {
  return env.AWS_REGION || env.AWS_DEFAULT_REGION || "unknown";
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: `${JSON.stringify(payload)}\n`,
  };
}

function errorResponse(statusCode, message, errorClass) {
  return jsonResponse(statusCode, {
    ok: false,
    error: message,
    error_class: errorClass,
  });
}

function getHeader(headers = {}, name) {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (String(key).toLowerCase() === lowerName) {
      return value;
    }
  }
  return null;
}

function routePath(event = {}) {
  return event.rawPath || event.requestContext?.http?.path || event.path || "/";
}

function routeMethod(event = {}) {
  return String(event.requestContext?.http?.method || event.httpMethod || "GET").toUpperCase();
}

function hasUrlField(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "url")) {
    return true;
  }
  return Object.values(value).some((item) => hasUrlField(item));
}

function parseJsonBody(event = {}) {
  if (!event.body) {
    return {};
  }
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  const payload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  if (hasUrlField(payload)) {
    throw requestError("Arbitrary url fields are not allowed.", "invalid_request", 400);
  }
  return payload;
}

function parseTargets(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson || "{}");
  } catch {
    throw new Error("TARGETS_JSON must be valid JSON.");
  }

  const targets = {};
  for (const [region, value] of Object.entries(parsed)) {
    const functionName = typeof value === "string" ? value : value?.function_name;
    if (!region || !functionName) {
      continue;
    }
    targets[region] = { functionName };
  }
  return targets;
}

function requestError(message, errorClass = "invalid_request", statusCode = 400) {
  const error = new Error(message);
  error.errorClass = errorClass;
  error.statusCode = statusCode;
  return error;
}

function normalizeKlineRequest(payload = {}) {
  const region = String(payload.region ?? "auto").trim() || "auto";
  const secid = String(payload.secid ?? "").trim();
  if (!/^[01]\.\d{6}$/.test(secid)) {
    throw requestError("secid must match 0.xxxxxx or 1.xxxxxx.");
  }

  const klt = Number(payload.klt);
  if (!VALID_KLTS.has(klt)) {
    throw requestError("klt must be 101 or 106.");
  }

  const lmt = payload.lmt === undefined ? DEFAULT_KLINE_LMT : Number(payload.lmt);
  if (!Number.isInteger(lmt) || lmt < 1) {
    throw requestError("lmt must be a positive integer.");
  }

  const end = String(payload.end ?? "20991231").trim();
  if (!/^\d{8}$/.test(end)) {
    throw requestError("end must be YYYYMMDD.");
  }

  return { region, secid, klt, lmt, end };
}

function parseRegionList(region) {
  return String(region ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveRegions(region, targets, { allowAll = false } = {}) {
  const targetRegions = Object.keys(targets);
  if (region === "auto") {
    return targetRegions;
  }
  if (region === "all" && allowAll) {
    return targetRegions;
  }
  const requestedRegions = parseRegionList(region);
  if (requestedRegions.length > 1) {
    const resolvedRegions = [];
    for (const requestedRegion of requestedRegions) {
      if (!Object.prototype.hasOwnProperty.call(targets, requestedRegion)) {
        throw requestError(`Region is not allowed: ${requestedRegion}`, "invalid_region", 400);
      }
      if (!resolvedRegions.includes(requestedRegion)) {
        resolvedRegions.push(requestedRegion);
      }
    }
    return resolvedRegions;
  }
  const requestedRegion = requestedRegions[0] ?? region;
  if (!Object.prototype.hasOwnProperty.call(targets, requestedRegion)) {
    throw requestError(`Region is not allowed: ${requestedRegion}`, "invalid_region", 400);
  }
  return [requestedRegion];
}

function isSingleRegionRequest(region) {
  return !String(region).includes(",") && region !== "auto" && region !== "all";
}

function classifyInvokeError(error) {
  const message = String(error?.message ?? error ?? "");
  if (error?.errorClass) {
    return error.errorClass;
  }
  if (/abort|timeout|timed out/i.test(message)) {
    return "timeout";
  }
  if (/invalid/i.test(message)) {
    return "invalid_request";
  }
  return "upstream";
}

export function createAwsInvoker({ lambdaClientFactory } = {}) {
  const clients = new Map();
  const factory = lambdaClientFactory ?? ((region) => new LambdaClient({ region }));
  return async function invokeTarget(region, target, payload, { timeoutMs = DEFAULT_TARGET_TIMEOUT_MS } = {}) {
    if (!clients.has(region)) {
      clients.set(region, factory(region));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await clients.get(region).send(
        new InvokeCommand({
          FunctionName: target.functionName,
          Payload: Buffer.from(JSON.stringify(payload)),
        }),
        { abortSignal: controller.signal }
      );
      const rawPayload = Buffer.from(response.Payload ?? []).toString("utf8");
      const invokePayload = rawPayload ? JSON.parse(rawPayload) : null;
      if (response.FunctionError) {
        throw new Error(`Lambda function error: ${response.FunctionError}`);
      }
      return invokePayload;
    } finally {
      clearTimeout(timer);
    }
  };
}

async function tryRegion(region, targets, payload, invokeTarget, options) {
  const startedAt = nowMs();
  try {
    const targetPayload = await invokeTarget(region, targets[region], payload, options);
    if (!targetPayload?.ok) {
      const error = new Error(targetPayload?.error ?? "Target returned failure.");
      error.errorClass = targetPayload?.error_class ?? "upstream";
      throw error;
    }
    return {
      ok: true,
      region,
      total_duration_ms: nowMs() - startedAt,
      target_duration_ms: targetPayload.target_duration_ms ?? null,
      eastmoney_duration_ms: targetPayload.eastmoney_duration_ms ?? null,
      payload: targetPayload,
    };
  } catch (error) {
    return {
      ok: false,
      region,
      total_duration_ms: nowMs() - startedAt,
      error: error?.message ?? String(error),
      error_class: classifyInvokeError(error),
    };
  }
}

async function handleProbe(body, context) {
  const payload = normalizeKlineRequest({
    ...body,
    region: body.region ?? "all",
    lmt: body.lmt ?? 1,
  });
  const regions = resolveRegions(payload.region, context.targets, { allowAll: true });
  const results = await Promise.all(
    regions.map((region) => tryRegion(region, context.targets, payload, context.invokeTarget, context.invokeOptions))
  );
  return jsonResponse(200, {
    ok: true,
    source_engine: "aws-router-probe",
    results: results.map(({ payload: _payload, ...result }) => result),
  });
}

async function handleKline(body, context) {
  const request = normalizeKlineRequest(body);
  const allRegions = resolveRegions(request.region, context.targets, { allowAll: true });
  const maxAttempts = isSingleRegionRequest(request.region)
    ? 1
    : Math.min(context.maxFallbacks, allRegions.length);
  const regions = allRegions.slice(0, maxAttempts);
  const attemptedRegions = [];
  const startedAt = nowMs();
  const failures = [];

  for (const region of regions) {
    attemptedRegions.push(region);
    const result = await tryRegion(region, context.targets, request, context.invokeTarget, context.invokeOptions);
    if (result.ok) {
      return jsonResponse(200, {
        ok: true,
        source_engine: "aws-router",
        source_region: region,
        router_duration_ms: nowMs() - startedAt - (result.target_duration_ms ?? 0),
        target_duration_ms: result.target_duration_ms,
        eastmoney_duration_ms: result.eastmoney_duration_ms,
        total_duration_ms: nowMs() - startedAt,
        fallback_count: attemptedRegions.length - 1,
        attempted_regions: attemptedRegions,
        data: result.payload.data,
      });
    }
    failures.push(result);
  }

  const lastFailure = failures.at(-1);
  return jsonResponse(lastFailure?.error_class === "timeout" ? 504 : 502, {
    ok: false,
    error: lastFailure?.error ?? "All target regions failed.",
    error_class: lastFailure?.error_class ?? "upstream",
    source_engine: "aws-router",
    total_duration_ms: nowMs() - startedAt,
    fallback_count: Math.max(0, attemptedRegions.length - 1),
    attempted_regions: attemptedRegions,
    failures,
  });
}

function verifyToken(event, env) {
  const expected = env.ROUTER_TOKEN;
  if (!expected) {
    throw requestError("ROUTER_TOKEN is not configured.", "unauthorized", 401);
  }
  const actual = getHeader(event.headers, "x-router-token");
  if (actual !== expected) {
    throw requestError("Invalid router token.", "unauthorized", 401);
  }
}

export function createHandler(options = {}) {
  const env = options.env ?? process.env;
  const targets = options.targets ?? parseTargets(env.TARGETS_JSON);
  const invokeTarget = options.invokeTarget ?? createAwsInvoker();
  const targetTimeoutMs = Number(env.ROUTER_TARGET_TIMEOUT_MS || DEFAULT_TARGET_TIMEOUT_MS);
  const maxFallbacks = Number(env.ROUTER_MAX_FALLBACKS || DEFAULT_MAX_FALLBACKS);

  return async function route(event = {}) {
    const method = routeMethod(event);
    const path = routePath(event);
    try {
      if (path === "/health") {
        if (method !== "GET") {
          return errorResponse(405, "Method not allowed.", "invalid_request");
        }
        return jsonResponse(200, {
          ok: true,
          service: "kline-router",
          region: routerRegion(env),
          time: new Date().toISOString(),
        });
      }

      if (!["/probe", "/kline"].includes(path)) {
        return errorResponse(404, "Path not found.", "not_found");
      }
      if (method !== "POST") {
        return errorResponse(405, "Method not allowed.", "invalid_request");
      }
      verifyToken(event, env);
      const contentType = getHeader(event.headers, "content-type") ?? "";
      if (!String(contentType).toLowerCase().includes("application/json")) {
        return errorResponse(400, "content-type must be application/json.", "invalid_request");
      }
      const body = parseJsonBody(event);
      const context = {
        targets,
        invokeTarget,
        invokeOptions: { timeoutMs: targetTimeoutMs },
        maxFallbacks: Number.isInteger(maxFallbacks) && maxFallbacks > 0 ? maxFallbacks : DEFAULT_MAX_FALLBACKS,
      };
      return path === "/probe"
        ? await handleProbe(body, context)
        : await handleKline(body, context);
    } catch (error) {
      return errorResponse(
        error.statusCode ?? 500,
        error?.message ?? String(error),
        error.errorClass ?? "upstream"
      );
    }
  };
}

export const handler = createHandler();
