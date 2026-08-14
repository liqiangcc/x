"use strict";

const {
  BUY_EXECUTION_MODEL_IDS,
} = require("../../../ports/simulation/buy_execution_model_resolver");
const { errorPayload, jsonResult } = require("../tool_result");

const TOOL_NAME = "simulation_run_drawdown_buying";

const INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    code: {
      type: "string",
      pattern: "^\\d{6}$",
      description: "Six-digit security code.",
    },
    market: {
      type: "integer",
      minimum: 0,
      description: "Market identifier used by the repository data contract.",
    },
    startDate: {
      type: ["string", "null"],
      pattern: "^\\d{4}-?\\d{2}-?\\d{2}$",
      description: "Optional inclusive simulation start date, YYYY-MM-DD or YYYYMMDD.",
    },
    endDate: {
      type: "string",
      pattern: "^\\d{4}-?\\d{2}-?\\d{2}$",
      description: "Inclusive simulation end date, YYYY-MM-DD or YYYYMMDD.",
    },
    period: {
      type: "string",
      enum: ["daily"],
      default: "daily",
      description: "Historical Kline period used by this research simulation.",
    },
    initialCapital: {
      type: "number",
      exclusiveMinimum: 0,
      default: 100000,
      description: "Initial simulation capital in currency units.",
    },
    initialDrawdown: {
      type: "number",
      minimum: 0,
      exclusiveMaximum: 1,
      default: 0,
      description: "Drawdown from the running peak required before the first purchase. 0 means the first signal is emitted immediately.",
    },
    drawdownStep: {
      type: "number",
      exclusiveMinimum: 0,
      exclusiveMaximum: 1,
      default: 0.08,
      description: "Required decline from the previous purchase signal price before another signal, for example 0.08 for 8%.",
    },
    trancheFraction: {
      type: "number",
      exclusiveMinimum: 0,
      exclusiveMaximum: 1,
      default: 0.1,
      description: "Fraction of initial capital allocated to each purchase. trancheFraction * maxPurchases must not exceed 1.",
    },
    maxPurchases: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 10,
      description: "Maximum number of purchase signals, including the first entry.",
    },
    lotSize: {
      type: "integer",
      minimum: 1,
      maximum: 1000000,
      default: 100,
      description: "Minimum executable buy quantity multiple.",
    },
    priceField: {
      type: "string",
      enum: ["open", "close", "high", "low"],
      default: "close",
      description: "Price field used for drawdown signals and final marking. Execution itself occurs through the selected execution model.",
    },
    securityMetadata: {
      type: "object",
      additionalProperties: false,
      properties: {
        instrumentType: {
          type: "string",
          enum: ["a_share", "etf"],
          description: "Explicit instrument classification used for automatic execution-profile selection.",
        },
        intradayRoundTripEligible: {
          type: "boolean",
          description: "Whether the instrument is explicitly confirmed eligible for same-day round-trip trading. Required by the application resolver for ETFs.",
        },
      },
      required: ["instrumentType"],
      description: "Optional explicit security metadata. When executionModel is omitted, this metadata is preferred; otherwise repository security metadata is used. ETF classification must explicitly state intradayRoundTripEligible so T+0 is never guessed from a code prefix.",
    },
    executionModel: {
      type: "string",
      enum: [...BUY_EXECUTION_MODEL_IDS],
      description: "Optional explicit execution-model override for controlled research comparisons. When omitted, the application resolves the profile from security metadata. legacy_a_share uses approximate A-share rules; domestic_stock_etf uses an approximate domestic stock-ETF T+1 profile; t0_etf must only be selected for an ETF confirmed eligible for exchange T+0 trading; frictionless removes fees, slippage and market restrictions while preserving next-trading-day-open timing.",
    },
  },
  required: ["code", "market", "endDate"],
});

const OUTPUT_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        security: {
          type: "object",
          additionalProperties: true,
          properties: {
            code: { type: "string" },
            market: { type: "integer" },
          },
          required: ["code", "market"],
        },
        period: { type: "string" },
        startDate: { type: ["string", "null"] },
        endDate: { type: "string" },
        config: { type: "object", additionalProperties: true },
        signals: { type: "array", items: { type: "object" } },
        trades: { type: "array", items: { type: "object" } },
        summary: { type: "object", additionalProperties: true },
        meta: {
          type: "object",
          additionalProperties: true,
          properties: {
            executionSelection: {
              type: "object",
              additionalProperties: true,
              properties: {
                mode: { type: "string" },
                profileId: { type: "string" },
                securityMetadataSource: { type: ["string", "null"] },
              },
              required: ["mode", "profileId", "securityMetadataSource"],
            },
            execution: {
              type: "object",
              additionalProperties: true,
              properties: {
                kind: { type: "string" },
                timing: { type: "string" },
                executionPriceField: { type: "string" },
                lotSize: { type: "integer" },
                feesIncluded: { type: "boolean" },
                slippageIncluded: { type: "boolean" },
                marketRestrictionsIncluded: { type: "boolean" },
              },
              required: [
                "kind",
                "timing",
                "executionPriceField",
                "lotSize",
                "feesIncluded",
                "slippageIncluded",
                "marketRestrictionsIncluded",
              ],
            },
          },
          required: ["executionSelection", "execution"],
        },
      },
      required: ["security", "period", "startDate", "endDate", "config", "signals", "trades", "summary", "meta"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        error: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            message: { type: "string" },
          },
          required: ["code", "message"],
        },
      },
      required: ["error"],
    },
  ],
});

const TOOL_DEFINITION = Object.freeze({
  name: TOOL_NAME,
  title: "Simulate Drawdown Buying",
  description: "Run a deterministic historical drawdown-buying research simulation against repository-backed Kline data. Execution-profile selection is separate from execution mechanics: when executionModel is omitted, the application resolves legacy_a_share, domestic_stock_etf, or t0_etf from explicit or repository security metadata, and ETF T+0 eligibility must be explicitly known rather than inferred from a code prefix. executionModel remains an explicit research override, including frictionless comparison. This is read-only analysis, not trade execution.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createSimulationRunDrawdownBuyingTool({ useCase } = {}) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("useCase must provide execute().");
  }
  return Object.freeze({
    definition: TOOL_DEFINITION,
    async handler(input = {}) {
      try {
        const result = await useCase.execute(input);
        return jsonResult(result);
      } catch (error) {
        return jsonResult(errorPayload(error), { isError: true });
      }
    },
  });
}

module.exports = {
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  TOOL_DEFINITION,
  TOOL_NAME,
  createSimulationRunDrawdownBuyingTool,
};
