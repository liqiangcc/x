"use strict";

const {
  DEFAULT_KLINE_LIMIT,
  LEDGER_DEFAULT_ADJUSTMENT,
  MAX_KLINE_LIMIT,
} = require("../../../application/market/get_kline_range");
const { errorPayload, jsonResult } = require("../tool_result");

const TOOL_NAME = "market_get_kline";

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
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_KLINE_LIMIT,
      default: DEFAULT_KLINE_LIMIT,
      description: "Maximum bars returned in one page. Results are the latest bars within the requested range.",
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

const BAR_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    date: { type: ["string", "null"] },
    open: { type: ["number", "null"] },
    close: { type: ["number", "null"] },
    high: { type: ["number", "null"] },
    low: { type: ["number", "null"] },
    volume: { type: ["number", "null"] },
    amount: { type: ["number", "null"] },
    changePct: { type: ["number", "null"] },
  },
  required: ["date", "open", "close", "high", "low", "volume", "amount", "changePct"],
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
        bars: { type: "array", items: BAR_SCHEMA },
        page: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer" },
            returnedBars: { type: "integer" },
            hasMore: { type: "boolean" },
            nextEndDate: { type: ["string", "null"] },
          },
          required: ["limit", "returnedBars", "hasMore", "nextEndDate"],
        },
        meta: { type: "object" },
      },
      required: ["security", "period", "startDate", "endDate", "adjustment", "bars", "page", "meta"],
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
  title: "Get Repository Kline Range",
  description: "Return a bounded, read-only page of repository-backed Kline bars with source, quality, price-view, and continuation metadata. This tool never triggers market-data synchronization.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createMarketGetKlineTool({ useCase } = {}) {
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
  BAR_SCHEMA,
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  TOOL_DEFINITION,
  TOOL_NAME,
  createMarketGetKlineTool,
};
