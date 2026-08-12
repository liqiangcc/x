"use strict";

const { errorPayload, jsonResult } = require("../tool_result");
const { MAX_OUTPUT_POINTS } = require("../../../application/analytics/calculate_bollinger");

const TOOL_NAME = "analytics_get_bollinger";

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
      description: "Inclusive analysis end date; acts as the no-future-data boundary.",
    },
    period: {
      type: "string",
      enum: ["daily", "yearly"],
      default: "daily",
      description: "Kline period exposed by the repository ledger.",
    },
    window: {
      type: "integer",
      minimum: 1,
      maximum: 250,
      default: 20,
      description: "Rolling BOLL window length.",
    },
    multiplier: {
      type: "number",
      minimum: 0,
      default: 2,
      description: "Standard-deviation multiplier used for upper and lower bands.",
    },
    stddevMode: {
      type: "string",
      enum: ["population", "sample"],
      default: "population",
      description: "Standard-deviation denominator convention.",
    },
    priceField: {
      type: "string",
      enum: ["open", "close", "high", "low"],
      default: "close",
      description: "Price field used by the shared deterministic BOLL implementation.",
    },
    points: {
      type: "integer",
      minimum: 1,
      maximum: MAX_OUTPUT_POINTS,
      default: 20,
      description: "Maximum number of most-recent BOLL points returned to the MCP client.",
    },
  },
  required: ["code", "market", "endDate"],
});

const BOLL_POINT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    date: { type: ["string", "null"] },
    price: { type: ["number", "null"] },
    lower: { type: ["number", "null"] },
    middle: { type: ["number", "null"] },
    stddev: { type: ["number", "null"] },
    upper: { type: ["number", "null"] },
  },
  required: ["date", "price", "lower", "middle", "stddev", "upper"],
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
        window: { type: "integer", minimum: 1 },
        multiplier: { type: "number", minimum: 0 },
        stddevMode: { type: "string", enum: ["population", "sample"] },
        priceField: { type: "string", enum: ["open", "close", "high", "low"] },
        points: { type: "array", items: BOLL_POINT_SCHEMA },
        latest: {
          oneOf: [BOLL_POINT_SCHEMA, { type: "null" }],
        },
        coverage: {
          type: "object",
          additionalProperties: false,
          properties: {
            inputBars: { type: "integer", minimum: 0 },
            returnedPoints: { type: "integer", minimum: 0 },
            validPoints: { type: "integer", minimum: 0 },
            warmupComplete: { type: "boolean" },
          },
          required: ["inputBars", "returnedPoints", "validPoints", "warmupComplete"],
        },
        meta: { type: "object" },
      },
      required: [
        "security",
        "period",
        "startDate",
        "endDate",
        "window",
        "multiplier",
        "stddevMode",
        "priceField",
        "points",
        "latest",
        "coverage",
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
  title: "Calculate Bollinger Bands",
  description: "Return bounded, deterministic Bollinger-band points from repository-backed Kline data. This read-only tool reuses the repository's existing BOLL implementation and never performs market-data synchronization.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createAnalyticsGetBollingerTool({ useCase } = {}) {
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
  BOLL_POINT_SCHEMA,
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  TOOL_DEFINITION,
  TOOL_NAME,
  createAnalyticsGetBollingerTool,
};
