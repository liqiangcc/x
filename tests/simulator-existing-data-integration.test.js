"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ExistingKlineRepository,
} = require("../src/simulator/adapters/ledger/existing_kline_repository");
const {
  ExistingUniverseRepository,
} = require("../src/simulator/adapters/ledger/existing_universe");
const {
  evaluateMvpDataGate,
} = require("../src/simulator/data/data_gate");

const AS_OF_DATE = "2026-07-01";
const NEXT_DATE = "2026-07-02";
const SECURITY = { code: "000001", market: 0 };

test("repository data provides a market universe without network access", async () => {
  const universe = await new ExistingUniverseRepository().listAvailableCodes({ asOfDate: AS_OF_DATE });
  assert.equal(universe.source, "market_universe_snapshot");
  assert.equal(universe.securities.length > 1000, true);
  assert.equal(
    universe.securities.some((security) =>
      security.code === SECURITY.code && security.market === SECURITY.market
    ),
    true
  );
  assert.equal(universe.qualityIssues.includes("survivorship_bias_possible"), true);
});

test("repository kline data supplies candidate windows and next-open execution", async () => {
  const universeRepository = new ExistingUniverseRepository();
  const klineRepository = new ExistingKlineRepository();
  const [universe, dailyHistory, yearlyHistory, nextOpen] = await Promise.all([
    universeRepository.listAvailableCodes({ asOfDate: AS_OF_DATE }),
    klineRepository.getLegacyHistory({ ...SECURITY, endDate: AS_OF_DATE, period: "daily" }),
    klineRepository.getLegacyHistory({ ...SECURITY, endDate: AS_OF_DATE, period: "yearly" }),
    klineRepository.getLegacyBar({ ...SECURITY, date: NEXT_DATE }),
  ]);

  assert.equal(dailyHistory.bars.length > 100, true);
  assert.equal(yearlyHistory.bars.length >= 4, true);
  assert.equal(dailyHistory.bars.every((bar) => bar.date <= AS_OF_DATE), true);
  assert.equal(yearlyHistory.bars.every((bar) => bar.date <= AS_OF_DATE), true);
  assert.equal(nextOpen.executionEligible, true);
  assert.equal(nextOpen.bar.open > 0, true);

  const gate = evaluateMvpDataGate({
    asOfDate: AS_OF_DATE,
    universe,
    candidateInputs: [{ candidateId: "candidate-a", dailyHistory, yearlyHistory }],
    executionInputs: [{ orderId: "order-a", ...nextOpen }],
    manifestInputs: [dailyHistory, yearlyHistory, nextOpen],
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.candidates[0].eligible, true);
  assert.equal(gate.executions[0].eligible, true);
  assert.equal(gate.manifest.files.length, 2);
  assert.match(gate.manifest.manifestHash, /^[a-f0-9]{64}$/);
});

test("repository legacy negative price is excluded without rewriting data", async () => {
  const result = await new ExistingKlineRepository().getLegacyBar({
    ...SECURITY,
    date: "1991-04-03",
  });
  assert.equal(result.executionEligible, false);
  assert.equal(result.qualityIssues.includes("invalid_execution_price"), true);
});
