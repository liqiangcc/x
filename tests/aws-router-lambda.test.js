"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const routerModuleUrl = pathToFileURL(path.join(__dirname, "..", "lambda", "router", "index.mjs")).href;

async function loadRouter() {
  return import(routerModuleUrl);
}

function event({ path = "/kline", method = "POST", token = "secret", body = {}, contentType = "application/json" } = {}) {
  return {
    rawPath: path,
    requestContext: {
      http: { method },
    },
    headers: {
      "x-router-token": token,
      "content-type": contentType,
    },
    body: JSON.stringify(body),
  };
}

function parseResponse(response) {
  return JSON.parse(response.body);
}

const targets = {
  "us-east-1": { functionName: "kline-target" },
  "ap-northeast-2": { functionName: "kline-target" },
};

function successPayload(region) {
  return {
    ok: true,
    source_engine: "aws-router-target",
    source_region: region,
    target_duration_ms: 20,
    eastmoney_duration_ms: 15,
    data: {
      code: "600519",
      market: 1,
      klines: ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"],
    },
  };
}

test("router health is public and does not invoke targets", async () => {
  const { createHandler } = await loadRouter();
  let calls = 0;
  const handler = createHandler({
    env: { ROUTER_TOKEN: "secret", AWS_REGION: "ap-northeast-1" },
    targets,
    invokeTarget: async () => {
      calls += 1;
      return successPayload("us-east-1");
    },
  });

  const response = await handler(event({ path: "/health", method: "GET", token: "" }));
  const payload = parseResponse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.region, "ap-northeast-1");
  assert.equal(calls, 0);
});

test("router rejects invalid token and arbitrary url fields", async () => {
  const { createHandler } = await loadRouter();
  const handler = createHandler({
    env: { ROUTER_TOKEN: "secret" },
    targets,
    invokeTarget: async () => successPayload("us-east-1"),
  });

  const unauthorized = await handler(event({ token: "wrong", body: { secid: "1.600519", klt: 101 } }));
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(parseResponse(unauthorized).error_class, "unauthorized");

  const badUrl = await handler(event({
    body: {
      secid: "1.600519",
      klt: 101,
      url: "https://example.com",
    },
  }));
  assert.equal(badUrl.statusCode, 400);
  assert.equal(parseResponse(badUrl).error_class, "invalid_request");
});

test("router only allows whitelisted regions", async () => {
  const { createHandler } = await loadRouter();
  const handler = createHandler({
    env: { ROUTER_TOKEN: "secret" },
    targets,
    invokeTarget: async () => successPayload("us-east-1"),
  });

  const response = await handler(event({
    body: {
      region: "eu-west-1",
      secid: "1.600519",
      klt: 101,
    },
  }));

  assert.equal(response.statusCode, 400);
  assert.equal(parseResponse(response).error_class, "invalid_region");
});

test("router kline falls back across target regions", async () => {
  const { createHandler } = await loadRouter();
  const attempted = [];
  const handler = createHandler({
    env: {
      ROUTER_TOKEN: "secret",
      ROUTER_MAX_FALLBACKS: "2",
    },
    targets,
    invokeTarget: async (region) => {
      attempted.push(region);
      if (region === "us-east-1") {
        return {
          ok: false,
          error: "timeout",
          error_class: "timeout",
        };
      }
      return successPayload(region);
    },
  });

  const response = await handler(event({
    body: {
      region: "auto",
      secid: "1.600519",
      klt: 101,
    },
  }));
  const payload = parseResponse(response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(attempted, ["us-east-1", "ap-northeast-2"]);
  assert.equal(payload.source_engine, "aws-router");
  assert.equal(payload.source_region, "ap-northeast-2");
  assert.equal(payload.fallback_count, 1);
  assert.deepEqual(payload.attempted_regions, ["us-east-1", "ap-northeast-2"]);
});

test("router probe returns per-region results", async () => {
  const { createHandler } = await loadRouter();
  const handler = createHandler({
    env: { ROUTER_TOKEN: "secret" },
    targets,
    invokeTarget: async (region) => {
      if (region === "us-east-1") {
        throw new Error("network failed");
      }
      return successPayload(region);
    },
  });

  const response = await handler(event({
    path: "/probe",
    body: {
      region: "all",
      secid: "1.600519",
      klt: 101,
      lmt: 1,
    },
  }));
  const payload = parseResponse(response);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.source_engine, "aws-router-probe");
  assert.equal(payload.results.length, 2);
  assert.deepEqual(
    payload.results.map((result) => ({ region: result.region, ok: result.ok })),
    [
      { region: "us-east-1", ok: false },
      { region: "ap-northeast-2", ok: true },
    ]
  );
});
