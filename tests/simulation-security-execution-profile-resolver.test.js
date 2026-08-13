"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertSecurityMetadataReader,
} = require("../src/ports/market/security_metadata_reader");
const {
  assertSecurityExecutionProfileResolver,
} = require("../src/ports/simulation/security_execution_profile_resolver");
const {
  LedgerSecurityMetadataReader,
} = require("../src/adapters/ledger/ledger_security_metadata_reader");
const {
  SimulateDrawdownBuyingUseCase,
} = require("../src/application/simulation/simulate_drawdown_buying");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

function securityMasterRecord() {
  return Object.freeze({
    security: Object.freeze({ code: "600001", market: 1 }),
    instrumentType: "a_share",
    intradayRoundTripEligible: false,
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    source: Object.freeze({
      provider: "test_provider",
      document: "security-master-test",
      version: "v1",
      collectedAt: "2026-07-01T00:00:00.000Z",
    }),
    qualityIssues: Object.freeze([]),
  });
}

test("security metadata reader port accepts only the narrow readMetadata capability", () => {
  const reader = { readMetadata() { return null; } };
  assert.equal(assertSecurityMetadataReader(reader), reader);
  assert.throws(() => assertSecurityMetadataReader(null), /must be an object/);
  assert.throws(() => assertSecurityMetadataReader({}), /readMetadata/);
});

test("ledger security metadata reader projects classification from SecurityMasterReader", () => {
  const masterCalls = [];
  const reader = new LedgerSecurityMetadataReader({
    securityMasterReader: {
      readRecord(security, options) {
        masterCalls.push({ security, options });
        return security.code === "600001" ? securityMasterRecord() : null;
      },
    },
  });
  assert.deepEqual(reader.readMetadata({ code: "600001", market: 1 }), {
    instrumentType: "a_share",
    intradayRoundTripEligible: false,
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    source: {
      kind: "security_master",
      provider: "test_provider",
      document: "security-master-test",
      version: "v1",
      collectedAt: "2026-07-01T00:00:00.000Z",
    },
    qualityIssues: [],
  });
  assert.equal(reader.readMetadata({ code: "510300", market: 1 }), null);
  assert.deepEqual(masterCalls, [
    { security: { code: "600001", market: 1 }, options: {} },
    { security: { code: "510300", market: 1 }, options: {} },
  ]);
});

test("security execution profile resolver maps explicit instrument metadata without execution mechanics", () => {
  const resolver = createSecurityExecutionProfileResolver();
  assert.equal(assertSecurityExecutionProfileResolver(resolver), resolver);
  assert.equal(resolver.resolve({
    security: { code: "600001", market: 1 },
    metadata: { instrumentType: "a_share" },
  }), "legacy_a_share");
  assert.equal(resolver.resolve({
    security: { code: "510300", market: 1 },
    metadata: { instrumentType: "etf", intradayRoundTripEligible: false },
  }), "domestic_stock_etf");
  assert.equal(resolver.resolve({
    security: { code: "513500", market: 1 },
    metadata: { instrumentType: "etf", intradayRoundTripEligible: true },
  }), "t0_etf");
});

test("security execution profile resolver fails closed for incomplete or contradictory eligibility metadata", () => {
  const resolver = createSecurityExecutionProfileResolver();
  assert.throws(
    () => resolver.resolve({
      security: { code: "510300", market: 1 },
      metadata: { instrumentType: "etf" },
    }),
    /must explicitly declare intradayRoundTripEligible/
  );
  assert.throws(
    () => resolver.resolve({
      security: { code: "600001", market: 1 },
      metadata: { instrumentType: "a_share", intradayRoundTripEligible: true },
    }),
    /cannot declare intradayRoundTripEligible=true/
  );
  assert.throws(
    () => resolver.resolve({
      security: { code: "600001", market: 1 },
      metadata: { instrumentType: "fund" },
    }),
    /instrumentType/
  );
});

test("simulation application resolves security metadata at the normalized backtest end date before execution mechanics", async () => {
  const calls = [];
  const useCase = new SimulateDrawdownBuyingUseCase({
    klineReader: {
      async readRange(input) {
        calls.push({ layer: "market", input });
        return {
          security: { code: "513500", market: 1 },
          period: "daily",
          startDate: "2026-01-02",
          endDate: "2026-01-05",
          bars: [],
          dataMode: "test",
          priceView: "raw",
          qualityIssues: [],
          source: { kind: "test" },
        };
      },
    },
    securityMetadataReader: {
      async readMetadata(security, options) {
        calls.push({ layer: "metadata", security, options });
        return { instrumentType: "etf", intradayRoundTripEligible: true };
      },
    },
    securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
    executionModelResolver: {
      resolve(input) {
        calls.push({ layer: "execution", input });
        return { kind: input.model };
      },
    },
    buildPlan() {
      calls.push({ layer: "policy" });
      return {
        signals: [],
        summary: { signalCount: 0 },
        config: {
          initialDrawdown: 0,
          drawdownStep: 0.08,
          trancheFraction: 0.1,
          maxPurchases: 10,
          priceField: "close",
        },
      };
    },
    simulatePortfolio(input) {
      calls.push({ layer: "portfolio", executionModel: input.executionModel });
      return {
        trades: [],
        summary: { filledTradeCount: 0 },
        config: {
          kind: input.executionModel.kind,
          timing: "next_trading_day_open",
          executionPriceField: "open",
          lotSize: 100,
          feesIncluded: true,
          slippageIncluded: true,
          marketRestrictionsIncluded: true,
        },
      };
    },
  });

  const result = await useCase.execute({
    code: "513500",
    market: 1,
    startDate: "2026-01-02",
    endDate: "2026-01-05",
  });

  assert.deepEqual(calls.map((call) => call.layer), [
    "market",
    "metadata",
    "policy",
    "execution",
    "portfolio",
  ]);
  assert.deepEqual(calls[1].security, { code: "513500", market: 1 });
  assert.deepEqual(calls[1].options, { asOf: "2026-01-05" });
  assert.deepEqual(calls[3].input, {
    model: "t0_etf",
    executionConfig: { lotSize: 100 },
  });
  assert.equal(result.config.executionModel, "t0_etf");
  assert.equal(result.config.executionModelSelection, "security_metadata");
  assert.deepEqual(result.meta.executionSelection, {
    mode: "security_metadata",
    profileId: "t0_etf",
    securityMetadataSource: "reader",
  });
});

test("simulation automatic profile selection fails closed when no metadata is effective at the backtest end date", async () => {
  const metadataCalls = [];
  let profileResolutions = 0;
  let executionResolutions = 0;
  const useCase = new SimulateDrawdownBuyingUseCase({
    klineReader: {
      async readRange() {
        return {
          security: { code: "513500", market: 1 },
          period: "daily",
          startDate: "2025-01-02",
          endDate: "2025-12-31",
          bars: [],
          qualityIssues: [],
          source: { kind: "test" },
        };
      },
    },
    securityMetadataReader: {
      async readMetadata(security, options) {
        metadataCalls.push({ security, options });
        return null;
      },
    },
    securityExecutionProfileResolver: {
      resolve() {
        profileResolutions += 1;
        return "t0_etf";
      },
    },
    executionModelResolver: {
      resolve() {
        executionResolutions += 1;
        return { kind: "unexpected" };
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({
      code: "513500",
      market: 1,
      startDate: "2025-01-02",
      endDate: "2025-12-31",
    }),
    /security metadata is required to resolve an execution profile automatically/
  );
  assert.deepEqual(metadataCalls, [{
    security: { code: "513500", market: 1 },
    options: { asOf: "2025-12-31" },
  }]);
  assert.equal(profileResolutions, 0);
  assert.equal(executionResolutions, 0);
});

test("explicit execution override bypasses security classification while preserving application orchestration", async () => {
  let metadataReads = 0;
  let profileResolutions = 0;
  const useCase = new SimulateDrawdownBuyingUseCase({
    klineReader: {
      async readRange() {
        return {
          security: { code: "600001", market: 1 },
          period: "daily",
          startDate: null,
          endDate: "2026-01-05",
          bars: [],
          qualityIssues: [],
          source: { kind: "test" },
        };
      },
    },
    securityMetadataReader: {
      async readMetadata() {
        metadataReads += 1;
        return { instrumentType: "a_share" };
      },
    },
    securityExecutionProfileResolver: {
      resolve() {
        profileResolutions += 1;
        return "legacy_a_share";
      },
    },
    executionModelResolver: {
      resolve({ model }) {
        return { model };
      },
    },
    buildPlan() {
      return { signals: [], summary: {}, config: {} };
    },
    simulatePortfolio({ executionModel }) {
      return { trades: [], summary: {}, config: { kind: executionModel.model } };
    },
  });

  const result = await useCase.execute({
    code: "600001",
    market: 1,
    endDate: "2026-01-05",
    executionModel: "frictionless",
  });

  assert.equal(metadataReads, 0);
  assert.equal(profileResolutions, 0);
  assert.equal(result.config.executionModel, "frictionless");
  assert.equal(result.config.executionModelSelection, "explicit_override");
  assert.deepEqual(result.meta.executionSelection, {
    mode: "explicit_override",
    profileId: "frictionless",
    securityMetadataSource: null,
  });
});
