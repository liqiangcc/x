"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  fetchAwsRouterKline,
  parseArguments,
} = require("../fetch/fetch_kline");

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("fetch_kline parses aws-router engine", () => {
  const options = parseArguments(["600519", "--engine", "aws-router"]);
  assert.equal(options.engine, "aws-router");
});

test("fetchAwsRouterKline requires router URL and token", async () => {
  await assert.rejects(
    () => fetchAwsRouterKline(
      "1.600519",
      "101",
      { routerUrlEnv: "AWS_ROUTER_URL", routerTokenEnv: "AWS_ROUTER_TOKEN" },
      {},
      async () => jsonResponse({})
    ),
    /AWS_ROUTER_URL/
  );
  await assert.rejects(
    () => fetchAwsRouterKline(
      "1.600519",
      "101",
      { routerUrlEnv: "AWS_ROUTER_URL", routerTokenEnv: "AWS_ROUTER_TOKEN" },
      { AWS_ROUTER_URL: "https://router.example" },
      async () => jsonResponse({})
    ),
    /AWS_ROUTER_TOKEN/
  );
});

test("fetchAwsRouterKline posts to router and preserves metrics", async () => {
  const requests = [];
  const payload = await fetchAwsRouterKline(
    "1.600519",
    "101",
    { routerUrlEnv: "AWS_ROUTER_URL", routerTokenEnv: "AWS_ROUTER_TOKEN" },
    {
      AWS_ROUTER_URL: "https://router.example/",
      AWS_ROUTER_TOKEN: "secret",
    },
    async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        ok: true,
        source_engine: "aws-router",
        source_region: "us-east-1",
        total_duration_ms: 50,
        target_duration_ms: 30,
        eastmoney_duration_ms: 20,
        fallback_count: 1,
        attempted_regions: ["ap-northeast-2", "us-east-1"],
        data: {
          code: "600519",
          market: 1,
          klines: ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"],
        },
      });
    }
  );

  assert.equal(requests[0].url, "https://router.example/kline");
  assert.equal(requests[0].options.headers["x-router-token"], "secret");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    region: "auto",
    secid: "1.600519",
    klt: 101,
    lmt: 100000,
    end: "20991231",
  });
  assert.equal(payload.source_engine, "aws-router");
  assert.equal(payload.source_region, "us-east-1");
  assert.equal(payload.total_duration_ms, 50);
  assert.equal(payload.fallback_count, 1);
  assert.deepEqual(payload.data.klines, ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"]);
});

test("fetchAwsRouterKline reports router failures", async () => {
  await assert.rejects(
    () => fetchAwsRouterKline(
      "1.600519",
      "101",
      { routerUrlEnv: "AWS_ROUTER_URL", routerTokenEnv: "AWS_ROUTER_TOKEN" },
      {
        AWS_ROUTER_URL: "https://router.example",
        AWS_ROUTER_TOKEN: "secret",
      },
      async () => jsonResponse(
        { ok: false, error: "all regions failed" },
        { ok: false, status: 502 }
      )
    ),
    /all regions failed/
  );
});
