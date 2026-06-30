"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildMarketStocksUrl, buildPoolRequest } = require("../src/sources/eastmoney/client");

test("buildPoolRequest patches date and JSONP callback without executing curl", async () => {
  const request = await buildPoolRequest("zt", "20260325");
  const url = new URL(request.url);

  assert.equal(url.searchParams.get("date"), "20260325");
  assert.match(url.searchParams.get("cb"), /^callbackdata\d+$/);
  assert.equal(url.hostname, "push2ex.eastmoney.com");
  assert.equal(request.headers.Referer, "https://quote.eastmoney.com/ztb/detail");
  assert.match(request.commandText, /^curl 'https:\/\/push2ex\.eastmoney\.com/);
});

test("buildPoolRequest rejects unknown pool names", async () => {
  await assert.rejects(() => buildPoolRequest("bad", "20260325"), /Invalid pool/);
});

test("buildMarketStocksUrl targets Shanghai and Shenzhen A-share lists", () => {
  const url = new URL(buildMarketStocksUrl("hs-a", 2, 300));

  assert.equal(url.hostname, "push2delay.eastmoney.com");
  assert.equal(url.searchParams.get("pn"), "2");
  assert.equal(url.searchParams.get("pz"), "300");
  assert.equal(url.searchParams.get("fs"), "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23");
  assert.match(url.searchParams.get("fields"), /f12/);
  assert.match(url.searchParams.get("fields"), /f13/);
  assert.match(url.searchParams.get("fields"), /f14/);
});
