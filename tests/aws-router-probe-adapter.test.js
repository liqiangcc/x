"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  appendUrlPath,
  createHttpRouterProbeClient,
  requiredEnv,
} = require("../src/adapters/aws/http_router_probe_client");

function response({ ok = true, status = 200, text = "{}" } = {}) {
  return {
    ok,
    status,
    async text() {
      return text;
    },
  };
}

test("router probe HTTP adapter preserves URL, token header, and JSON body", async () => {
  const calls = [];
  const client = createHttpRouterProbeClient({
    env: {
      AWS_ROUTER_URL: "https://router.example/base/",
      AWS_ROUTER_TOKEN: "secret-token",
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return response({ text: '{"ok":true,"region":"r1"}' });
    },
  });
  const body = { region: "all", secid: "1.600519", klt: 101, lmt: 1, end: "20991231" };

  assert.deepEqual(await client.probe(body), { ok: true, region: "r1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://router.example/base/probe");
  assert.deepEqual(calls[0].options, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-router-token": "secret-token",
    },
    body: JSON.stringify(body),
  });
});

test("router probe HTTP adapter preserves environment validation", async () => {
  assert.equal(appendUrlPath("https://router.example///", "/probe"), "https://router.example/probe");
  assert.throws(() => requiredEnv({}, "AWS_ROUTER_URL"), /AWS_ROUTER_URL is required\./);

  const missingUrl = createHttpRouterProbeClient({ env: {}, fetchImpl: async () => response() });
  await assert.rejects(() => missingUrl.probe({}), /AWS_ROUTER_URL is required\./);

  const missingToken = createHttpRouterProbeClient({
    env: { AWS_ROUTER_URL: "https://router.example" },
    fetchImpl: async () => response(),
  });
  await assert.rejects(() => missingToken.probe({}), /AWS_ROUTER_TOKEN is required\./);
});

test("router probe HTTP adapter preserves response parsing and status errors", async () => {
  const env = {
    AWS_ROUTER_URL: "https://router.example",
    AWS_ROUTER_TOKEN: "token",
  };

  const invalidJson = createHttpRouterProbeClient({
    env,
    fetchImpl: async () => response({ text: "not-json" }),
  });
  await assert.rejects(
    () => invalidJson.probe({}),
    /Failed to parse Router response:/
  );

  const failedStatus = createHttpRouterProbeClient({
    env,
    fetchImpl: async () => response({ ok: false, status: 503, text: '{"error":"down"}' }),
  });
  await assert.rejects(
    () => failedStatus.probe({}),
    /Router returned statusCode 503: down/
  );

  const failedPayload = createHttpRouterProbeClient({
    env,
    fetchImpl: async () => response({ status: 200, text: '{"ok":false,"error":"rejected"}' }),
  });
  await assert.rejects(
    () => failedPayload.probe({}),
    /Router returned statusCode 200: rejected/
  );
});
