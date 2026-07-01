"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildStockUniverse,
  fetchMarketStocks,
  isHsAStock,
  normalizeMarketStock,
  parseArguments,
  resolveDate,
} = require("../fetch/fetch_market_stocks");

async function makeTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fetch-market-stocks-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("isHsAStock accepts only Shanghai and Shenzhen A-share code ranges", () => {
  assert.equal(isHsAStock("600519", 1), true);
  assert.equal(isHsAStock("688001", 1), true);
  assert.equal(isHsAStock("000001", 0), true);
  assert.equal(isHsAStock("300750", 0), true);
  assert.equal(isHsAStock("302132", 0), true);
  assert.equal(isHsAStock("920001", 0), false);
  assert.equal(isHsAStock("900901", 1), false);
  assert.equal(isHsAStock("200001", 0), false);
  assert.equal(isHsAStock("510300", 1), false);
  assert.equal(isHsAStock("399001", 0), false);
});

test("normalizeMarketStock maps Eastmoney fields to stable stock records", () => {
  assert.deepEqual(
    normalizeMarketStock({ f12: "600519", f13: 1, f14: "Kweichow Moutai", f2: "1500.5", f3: "1.2", f124: 1782892800 }),
    {
      code: "600519",
      name: "Kweichow Moutai",
      market_id: 1,
      market: "sh",
      secid: "1.600519",
      board: "main",
      quote_available: true,
      latest_price: 1500.5,
      change_pct: 1.2,
      quote_timestamp: 1782892800,
    }
  );
  assert.equal(normalizeMarketStock({ f12: "600520", f13: 1, f14: "Unavailable", f2: "-" }).quote_available, false);
  assert.equal(normalizeMarketStock({ f12: "920001", f13: 0, f14: "BSE sample" }), null);
});

test("buildStockUniverse filters, deduplicates, and sorts codes", () => {
  const universe = buildStockUniverse({
    date: "20260630",
    market: "hs-a",
    generatedAt: "2026-06-30T00:00:00Z",
    payload: {
      data: {
        total: 7,
        diff: [
          { f12: "300750", f13: 0, f14: "CATL", f2: "300" },
          { f12: "302132", f13: 0, f14: "AVIC Chengfei", f2: "-" },
          { f12: "600519", f13: 1, f14: "Kweichow Moutai", f2: "1500" },
          { f12: "920001", f13: 0, f14: "BSE sample" },
          { f12: "510300", f13: 1, f14: "CSI 300 ETF" },
          { f12: "000001", f13: 0, f14: "Ping An Bank", f2: "10" },
          { f12: "600519", f13: 1, f14: "Kweichow Moutai", f2: "1500" },
        ],
      },
    },
  });

  assert.deepEqual(universe.codesPayload.codes, ["000001", "300750", "302132", "600519"]);
  assert.equal(universe.stocksPayload.total_raw, 7);
  assert.equal(universe.stocksPayload.total_stocks, 4);
  assert.equal(universe.stocksPayload.quote_available, 3);
  assert.equal(universe.stocksPayload.quote_unavailable, 1);
  assert.equal(universe.summary.status, "completed");
});

test("fetchMarketStocks writes stocks, codes, and summaries", async (t) => {
  const dir = await makeTempDir(t);
  const summary = await fetchMarketStocks(
    {
      date: "20260630",
      market: "hs-a",
      outputDir: dir,
      pageSize: 500,
    },
    async () => ({
      data: {
        total: 2,
        diff: [
          { f12: "600519", f13: 1, f14: "Kweichow Moutai", f2: "1500" },
          { f12: "000001", f13: 0, f14: "Ping An Bank", f2: "10" },
        ],
      },
    })
  );

  assert.equal(summary.total_codes, 2);
  const codes = JSON.parse(await fs.readFile(path.join(dir, "20260630", "codes.json"), "utf8"));
  const stocks = JSON.parse(await fs.readFile(path.join(dir, "20260630", "stocks.json"), "utf8"));
  const rootSummary = JSON.parse(await fs.readFile(path.join(dir, "summary.json"), "utf8"));
  assert.deepEqual(codes.codes, ["000001", "600519"]);
  assert.equal(stocks.stocks.length, 2);
  assert.equal(stocks.quote_available, 2);
  assert.equal(rootSummary.date, "20260630");
});

test("parseArguments defaults to latest hs-a universe", () => {
  const options = parseArguments([]);
  assert.equal(options.latest, true);
  assert.equal(options.market, "hs-a");
  assert.equal(resolveDate({ date: null }, new Date("2026-06-29T16:30:00.000Z")), "20260630");
});
