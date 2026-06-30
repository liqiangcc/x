"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveTradingDate } = require("../fetch/fetch_pool");

test("resolveTradingDate falls back to market date for latest lookup failures", async () => {
  const resolved = await resolveTradingDate(0, {
    now: new Date("2026-06-29T16:30:00.000Z"),
    warn: () => {},
    execFileAsync: async () => {
      throw new Error("fetch failed");
    },
  });

  assert.equal(resolved, "20260630");
});

test("resolveTradingDate preserves failures for non-latest offsets", async () => {
  await assert.rejects(
    () =>
      resolveTradingDate(1, {
        now: new Date("2026-06-29T16:30:00.000Z"),
        execFileAsync: async () => {
          throw new Error("fetch failed");
        },
      }),
    /fetch failed/
  );
});
