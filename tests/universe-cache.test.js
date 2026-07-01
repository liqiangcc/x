"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  hasCompleteMarketUniverse,
  shouldReuseMarketUniverse,
} = require("../src/jobs/universe");

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("hasCompleteMarketUniverse accepts matching stock and code payloads", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "x-universe-cache-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const dateDir = path.join(tempDir, "20260701");

  await writeJson(path.join(dateDir, "codes.json"), {
    date: "20260701",
    market: "hs-a",
    codes: ["000001", "600519"],
  });
  await writeJson(path.join(dateDir, "stocks.json"), {
    date: "20260701",
    market: "hs-a",
    stocks: [{ code: "000001" }, { code: "600519" }],
  });

  assert.equal(await hasCompleteMarketUniverse("20260701", tempDir, "hs-a"), true);
  assert.equal(await hasCompleteMarketUniverse("20260702", tempDir, "hs-a"), false);
});

test("hasCompleteMarketUniverse rejects mismatched market or counts", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "x-universe-cache-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const dateDir = path.join(tempDir, "20260701");

  await writeJson(path.join(dateDir, "codes.json"), {
    date: "20260701",
    market: "hs-a",
    codes: ["000001"],
  });
  await writeJson(path.join(dateDir, "stocks.json"), {
    date: "20260701",
    market: "other",
    stocks: [{ code: "000001" }],
  });

  assert.equal(await hasCompleteMarketUniverse("20260701", tempDir, "hs-a"), false);
});

test("shouldReuseMarketUniverse respects forceUniverse", () => {
  assert.equal(shouldReuseMarketUniverse({ complete: true, forceUniverse: false }), true);
  assert.equal(shouldReuseMarketUniverse({ complete: true, forceUniverse: true }), false);
  assert.equal(shouldReuseMarketUniverse({ complete: false, forceUniverse: false }), false);
});
