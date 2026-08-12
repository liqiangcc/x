"use strict";

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
      description: "Drawdown from the running peak required before the first purchase. 0 means enter immediately.",
    },
    drawdownStep: {
      type: "number",
      exclusiveMinimum: 0,
      exclusiveMaximum: 1,
      default: 0.08,
      description: "Required decline from the previous purchase price before another purchase, for example 0.08 for 8%.",
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
      description: "Maximum number of purchases, including the first entry.",
    },
    lotSize: {
      type: "integer",
      minimum: 1,
      maximum: 1000000,
      default: 1,
      description: "Minimum executable share quantity multiple used by the deterministic portfolio simulation.",
    },
    priceField: {
      type: "string",
      enum: ["open", "close", "high", "low"],
      default: "close",
      description: "Price field used both for drawdown triggers and simulated fills.",
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
            execution: {
              type: "object",
              additionalProperties: true,
              properties: {
                feesIncluded: { type: "boolean" },
                slippageIncluded: { type: "boolean" },
              },
              required: ["feesIncluded", "slippageIncluded"],
            },
          },
          required: ["execution"],
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
  description: "Run a deterministic historical drawdown-buying research simulation against repository-backed Kline data. This is read-only analysis, not trade execution. The current execution model excludes fees and slippage and reports those assumptions in the result.",
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
