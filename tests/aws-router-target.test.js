"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const targetModuleUrl = pathToFileURL(path.join(__dirname, "..", "lambda", "target-kline", "index.mjs")).href;

async function loadTarget() {
  return import(targetModuleUrl);
}

function mockFetch(payload) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  });
}

test("target lambda validates kline input", async () => {
  const { normalizeTargetInput } = await loadTarget();

  assert.deepEqual(
    normalizeTargetInput({
      secid: "1.600519",
      klt: 101,
    }),
    {
      secid: "1.600519",
      klt: 101,
      lmt: 10000,
      end: "20991231",
    }
  );
  assert.throws(() => normalizeTargetInput({ secid: "2.600519", klt: 101 }), /secid/);
  assert.throws(() => normalizeTargetInput({ secid: "1.600519", klt: 5 }), /klt/);
  assert.throws(() => normalizeTargetInput({ secid: "1.600519", klt: 101, lmt: 0 }), /lmt/);
  assert.throws(() => normalizeTargetInput({ secid: "1.600519", klt: 101, end: "bad" }), /end/);
});

test("target lambda builds the Eastmoney kline URL from the HTTPS endpoint by default", async () => {
  const { buildEastmoneyKlineUrl } = await loadTarget();
  const url = new URL(buildEastmoneyKlineUrl({
    secid: "1.600519",
    klt: 101,
    lmt: 1,
    end: "20991231",
  }));

  assert.equal(url.origin, "https://push2his.eastmoney.com");
  assert.equal(url.pathname, "/api/qt/stock/kline/get");
  assert.equal(url.searchParams.get("secid"), "1.600519");
  assert.equal(url.searchParams.get("klt"), "101");
  assert.equal(url.searchParams.get("iscca"), "1");
  assert.equal(url.searchParams.get("lmt"), "1");
});

test("target lambda returns normalized successful kline payload", async () => {
  const { handleTargetKline } = await loadTarget();
  const response = await handleTargetKline(
    {
      secid: "1.600519",
      klt: 101,
      lmt: 1,
      end: "20991231",
    },
    {
      env: { AWS_REGION: "us-east-1" },
      fetchImpl: mockFetch({
        data: {
          code: "600519",
          market: 1,
          klines: ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"],
        },
      }),
    }
  );

  assert.equal(response.ok, true);
  assert.equal(response.source_engine, "aws-router-target");
  assert.equal(response.source_region, "us-east-1");
  assert.equal(response.data.code, "600519");
  assert.deepEqual(response.data.klines, ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"]);
  assert.equal(Number.isFinite(response.target_duration_ms), true);
  assert.equal(Number.isFinite(response.eastmoney_duration_ms), true);
});

test("target lambda returns structured failures", async () => {
  const { handleTargetKline } = await loadTarget();
  const response = await handleTargetKline(
    {
      secid: "bad",
      klt: 101,
    },
    {
      env: { AWS_REGION: "us-east-1" },
      fetchImpl: mockFetch({ data: { klines: [] } }),
    }
  );

  assert.equal(response.ok, false);
  assert.equal(response.error_class, "invalid_request");
  assert.equal(response.source_region, "us-east-1");
});
