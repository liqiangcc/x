"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  copyMarketUniverseSnapshot,
  hasCompleteMarketUniverse,
  marketUniverseRootForRun,
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
    stocks: [
      { code: "000001", quote_available: true },
      { code: "600519", quote_available: true },
    ],
  });

  assert.equal(await hasCompleteMarketUniverse("20260701", tempDir, "hs-a"), true);
  assert.equal(await hasCompleteMarketUniverse("20260702", tempDir, "hs-a"), false);
});

test("hasCompleteMarketUniverse rejects legacy payloads without quote metadata", async (t) => {
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
    market: "hs-a",
    stocks: [{ code: "000001" }],
  });

  assert.equal(await hasCompleteMarketUniverse("20260701", tempDir, "hs-a"), false);
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

test("marketUniverseRootForRun isolates batch and single run inputs", () => {
  assert.equal(
    marketUniverseRootForRun(
      {
        date: "20260701",
        jobId: "20260701-daily-market-hs-a",
        jobMode: "batch",
        period: "daily",
        runId: "ignored",
      },
      {
        jobsDir: "data/jobs",
        runsDir: "runs",
      }
    ),
    path.join("data", "jobs", "20260701", "daily", "20260701-daily-market-hs-a", "universe")
  );
  assert.equal(
    marketUniverseRootForRun(
      {
        date: "20260701",
        jobMode: "single",
        period: "yearly",
        runId: "20260701T000000Z_yearly",
      },
      {
        jobsDir: "data/jobs",
        runsDir: "runs",
      }
    ),
    path.join("runs", "20260701T000000Z_yearly", "universe")
  );
});

test("copyMarketUniverseSnapshot copies shared universe into an isolated root", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "x-universe-copy-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const sharedRoot = path.join(tempDir, "shared");
  const privateRoot = path.join(tempDir, "private");
  const sharedDateDir = path.join(sharedRoot, "20260701");

  await writeJson(path.join(sharedDateDir, "codes.json"), {
    date: "20260701",
    market: "hs-a",
    codes: ["000001", "600519"],
  });
  await writeJson(path.join(sharedDateDir, "stocks.json"), {
    date: "20260701",
    market: "hs-a",
    stocks: [
      { code: "000001", quote_available: true },
      { code: "600519", quote_available: true },
    ],
  });
  await writeJson(path.join(sharedDateDir, "summary.json"), {
    date: "20260701",
    market: "hs-a",
    total_codes: 2,
  });
  await writeJson(path.join(sharedRoot, "summary.json"), {
    date: "20260701",
    market: "hs-a",
    total_codes: 2,
  });

  await copyMarketUniverseSnapshot("20260701", sharedRoot, privateRoot);

  assert.equal(await hasCompleteMarketUniverse("20260701", privateRoot, "hs-a"), true);
  const rootSummary = JSON.parse(await fs.readFile(path.join(privateRoot, "summary.json"), "utf8"));
  assert.equal(rootSummary.total_codes, 2);
});
