"use strict";

const { errorPayload, jsonResult } = require("../tool_result");

const TOOL_NAME = "analytics_get_drawdowns";

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
      description: "Optional inclusive analysis start date, YYYY-MM-DD or YYYYMMDD.",
    },
    endDate: {
      type: "string",
      pattern: "^\\d{4}-?\\d{2}-?\\d{2}$",
      description: "Inclusive analysis end date, YYYY-MM-DD or YYYYMMDD.",
    },
    period: {
      type: "string",
      enum: ["daily", "yearly"],
      default: "daily",
      description: "Kline period exposed by the current ledger reader.",
    },
    minDrawdown: {
      type: "number",
      minimum: 0,
      exclusiveMaximum: 1,
      default: 0,
      description: "Minimum peak-to-trough drawdown magnitude as a decimal ratio, for example 0.2 for 20%.",
    },
    priceField: {
      type: "string",
      enum: ["open", "close", "high", "low"],
      default: "close",
      description: "Price field used by the deterministic drawdown calculation.",
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
        minDrawdown: { type: "number" },
        priceField: { type: "string" },
        events: { type: "array", items: { type: "object" } },
        summary: { type: "object" },
        meta: { type: "object" },
      },
      required: [
        "security",
        "period",
        "startDate",
        "endDate",
        "minDrawdown",
        "priceField",
        "events",
        "summary",
        "meta",
      ],
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
  title: "Analyze Stock Drawdowns",
  description: "Return deterministic peak-to-trough drawdown events from repository-backed Kline data. This tool is read-only and delegates all market-data access and analytics to the application layer.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createAnalyticsGetDrawdownsTool({ useCase } = {}) {
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
  createAnalyticsGetDrawdownsTool,
};
