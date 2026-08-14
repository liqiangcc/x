"use strict";

const { LEDGER_DEFAULT_ADJUSTMENT } = require("../../../application/market/get_kline_range");
const { errorPayload, jsonResult } = require("../tool_result");

const TOOL_NAME = "market_get_summary";

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
      description: "Optional inclusive range start date, YYYY-MM-DD or YYYYMMDD.",
    },
    endDate: {
      type: "string",
      pattern: "^\\d{4}-?\\d{2}-?\\d{2}$",
      description: "Inclusive range end date, YYYY-MM-DD or YYYYMMDD.",
    },
    period: {
      type: "string",
      enum: ["daily", "yearly"],
      default: "daily",
      description: "Kline period exposed by the repository ledger.",
    },
    adjustment: {
      type: "string",
      enum: [LEDGER_DEFAULT_ADJUSTMENT],
      default: LEDGER_DEFAULT_ADJUSTMENT,
      description: "Explicit price-adjustment policy. The current ledger exposes only its stored default view.",
    },
  },
  required: ["code", "market", "endDate"],
});

const POINT_SCHEMA = Object.freeze({
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    date: { type: ["string", "null"] },
    price: { type: "number" },
  },
  required: ["date", "price"],
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
        adjustment: { type: "string" },
        latest: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            date: { type: ["string", "null"] },
            close: { type: ["number", "null"] },
          },
          required: ["date", "close"],
        },
        range: {
          type: "object",
          additionalProperties: false,
          properties: {
            firstDate: { type: ["string", "null"] },
            lastDate: { type: ["string", "null"] },
            firstClose: { type: ["number", "null"] },
            lastClose: { type: ["number", "null"] },
            returnRate: { type: ["number", "null"] },
            high: POINT_SCHEMA,
            low: POINT_SCHEMA,
          },
          required: ["firstDate", "lastDate", "firstClose", "lastClose", "returnRate", "high", "low"],
        },
        coverage: {
          type: "object",
          additionalProperties: false,
          properties: {
            requestedStartDate: { type: ["string", "null"] },
            requestedEndDate: { type: "string" },
            observedStartDate: { type: ["string", "null"] },
            observedEndDate: { type: ["string", "null"] },
            barCount: { type: "integer", minimum: 0 },
          },
          required: ["requestedStartDate", "requestedEndDate", "observedStartDate", "observedEndDate", "barCount"],
        },
        meta: { type: "object" },
      },
      required: ["security", "period", "startDate", "endDate", "adjustment", "latest", "range", "coverage", "meta"],
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
  title: "Get Repository Market Summary",
  description: "Return a compact, deterministic summary for a repository-backed Kline range: latest close, range return, high/low, observed coverage, source, quality, and price-view metadata. This tool never triggers market-data synchronization.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createMarketGetSummaryTool({ useCase } = {}) {
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
  POINT_SCHEMA,
  TOOL_DEFINITION,
  TOOL_NAME,
  createMarketGetSummaryTool,
};
