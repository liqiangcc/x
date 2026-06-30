"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extractTradingDates } = require("../utils/generate_trading_days");

test("extractTradingDates filters and normalizes kline dates", () => {
  const payload = {
    data: {
      klines: [
        "2026-03-24,1,2,3",
        "2026-03-25,1,2,3",
        "2026-03-26,1,2,3",
      ],
    },
  };
  assert.deepEqual(extractTradingDates(payload, "20260325", "20260326"), ["20260325", "20260326"]);
});

test("extractTradingDates rejects payloads without kline arrays", () => {
  assert.throws(() => extractTradingDates({ data: {} }, "20260325", "20260326"), /kline data/);
});
