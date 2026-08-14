"use strict";

const { errorPayload, jsonResult } = require("../tool_result");

const TOOL_NAME = "analytics_get_recovery_periods";

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
      description: "Price field used by the deterministic recovery-period calculation.",
    },
  },
  required: ["code", "market", "endDate"],
});

const PERIOD_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    peakDate: { type: "string" },
    peakPrice: { type: "number" },
    troughDate: { type: "string" },
    troughPrice: { type: "number" },
    drawdown: { type: "number" },
    declineTradingDays: { type: "integer", minimum: 0 },
    recoveryDate: { type: ["string", "null"] },
    recoveryTradingDays: { type: ["integer", "null"], minimum: 0 },
    underwaterTradingDays: { type: ["integer", "null"], minimum: 0 },
    status: { type: "string", enum: ["recovered", "ongoing"] },
  },
  required: [
    "peakDate",
    "peakPrice",
    "troughDate",
    "troughPrice",
    "drawdown",
    "declineTradingDays",
    "recoveryDate",
    "recoveryTradingDays",
    "underwaterTradingDays",
    "status",
  ],
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
        periods: { type: "array", items: PERIOD_SCHEMA },
        summary: {
          type: "object",
          additionalProperties: false,
          properties: {
            eventCount: { type: "integer", minimum: 0 },
            recoveredCount: { type: "integer", minimum: 0 },
            ongoingCount: { type: "integer", minimum: 0 },
            averageRecoveryTradingDays: { type: ["number", "null"] },
            maxRecoveryTradingDays: { type: ["integer", "null"], minimum: 0 },
            averageUnderwaterTradingDays: { type: ["number", "null"] },
            maxUnderwaterTradingDays: { type: ["integer", "null"], minimum: 0 },
          },
          required: [
            "eventCount",
            "recoveredCount",
            "ongoingCount",
            "averageRecoveryTradingDays",
            "maxRecoveryTradingDays",
            "averageUnderwaterTradingDays",
            "maxUnderwaterTradingDays",
          ],
        },
        meta: { type: "object" },
      },
      required: [
        "security",
        "period",
        "startDate",
        "endDate",
        "minDrawdown",
        "priceField",
        "periods",
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
  title: "Analyze Recovery Periods",
  description: "Return deterministic decline, recovery, and total underwater trading-day durations for repository-backed drawdown events. This read-only tool reuses the shared drawdown segmentation capability and delegates data access to the application layer.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createAnalyticsGetRecoveryPeriodsTool({ useCase } = {}) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("useCase must provide execute().");
  }
  return Object.freeze({
    definition: TOOL_DEFINITION,
    async handler(input = {}) {
      try {
        return jsonResult(await useCase.execute(input));
      } catch (error) {
        return jsonResult(errorPayload(error), { isError: true });
      }
    },
  });
}

module.exports = {
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  PERIOD_SCHEMA,
  TOOL_DEFINITION,
  TOOL_NAME,
  createAnalyticsGetRecoveryPeriodsTool,
};
