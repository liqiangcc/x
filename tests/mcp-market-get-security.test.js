"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { GetSecurityUseCase } = require("../src/application/market/get_security");
const {
  TOOL_DEFINITION,
  createMarketGetSecurityTool,
} = require("../src/adapters/mcp/tools/market_get_security");

function source() {
  return {
    provider: "test_provider",
    document: "security-master-test",
    version: "v1",
    collectedAt: "2026-08-14T00:00:00.000Z",
  };
}

function record(code, market, instrumentType = "etf") {
  return {
    security: { code, market },
    instrumentType,
    intradayRoundTripEligible: false,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    source: source(),
    qualityIssues: [],
  };
}

function reader(records) {
  return {
    readRecord(security) {
      return records.find((item) => (
        item.security.code === security.code && item.security.market === security.market
      )) ?? null;
    },
    readSnapshot() {
      return {
        available: true,
        entries: records.map((item) => ({ record: item })),
        source: { kind: "fake" },
      };
    },
  };
}

test("market_get_security is a narrow read-only MCP adapter", () => {
  assert.equal(TOOL_DEFINITION.name, "market_get_security");
  assert.deepEqual(TOOL_DEFINITION.inputSchema.required, ["code"]);
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
  assert.equal(TOOL_DEFINITION.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITION.annotations.destructiveHint, false);
  assert.equal(TOOL_DEFINITION.annotations.idempotentHint, true);
});

test("GetSecurityUseCase resolves a unique code without guessing inside the MCP adapter", async () => {
  const useCase = new GetSecurityUseCase({ securityMasterReader: reader([record("512010", 1)]) });
  const result = await useCase.execute({ code: "512010", asOf: "2026-08-14" });

  assert.deepEqual(result.security, {
    code: "512010",
    market: 1,
    instrumentType: "etf",
    intradayRoundTripEligible: false,
  });
  assert.equal(result.meta.asOf, "2026-08-14");
  assert.deepEqual(result.meta.qualityIssues, []);
});

test("GetSecurityUseCase requires market when a code is ambiguous", async () => {
  const useCase = new GetSecurityUseCase({
    securityMasterReader: reader([
      record("123456", 0, "a_share"),
      record("123456", 1, "a_share"),
    ]),
  });

  await assert.rejects(
    () => useCase.execute({ code: "123456" }),
    /market is required/
  );
});

test("GetSecurityUseCase returns a stable not-found error code", async () => {
  const useCase = new GetSecurityUseCase({ securityMasterReader: reader([]) });
  await assert.rejects(
    () => useCase.execute({ code: "512010", market: 1 }),
    (error) => error.code === "security_not_found"
  );
});

test("market_get_security handler delegates to the application use case and maps errors", async () => {
  const calls = [];
  const expected = {
    security: {
      code: "512010",
      market: 1,
      instrumentType: "etf",
      intradayRoundTripEligible: false,
    },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    meta: { asOf: null, qualityIssues: [], source: source() },
  };
  const tool = createMarketGetSecurityTool({
    useCase: {
      async execute(input) {
        calls.push(input);
        return expected;
      },
    },
  });

  const result = await tool.handler({ code: "512010" });
  assert.deepEqual(calls, [{ code: "512010" }]);
  assert.deepEqual(result.structuredContent, expected);
  assert.equal(result.isError, undefined);

  const failing = createMarketGetSecurityTool({
    useCase: {
      async execute() {
        const error = new Error("missing");
        error.code = "security_not_found";
        throw error;
      },
    },
  });
  const errorResult = await failing.handler({ code: "000000" });
  assert.equal(errorResult.isError, true);
  assert.deepEqual(errorResult.structuredContent, {
    error: { code: "security_not_found", message: "missing" },
  });
});
