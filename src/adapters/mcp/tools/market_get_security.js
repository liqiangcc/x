"use strict";

const { errorPayload, jsonResult } = require("../tool_result");

const TOOL_NAME = "market_get_security";

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
      description: "Optional market identifier. Required only when the same code is ambiguous across markets.",
    },
    asOf: {
      type: ["string", "null"],
      pattern: "^\\d{4}-?\\d{2}-?\\d{2}$",
      description: "Optional point-in-time date. The repository reader must not return a record outside its effective range.",
    },
  },
  required: ["code"],
});

const OUTPUT_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        security: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            market: { type: "integer" },
            instrumentType: { type: "string" },
            intradayRoundTripEligible: { type: "boolean" },
          },
          required: ["code", "market", "instrumentType", "intradayRoundTripEligible"],
        },
        effectiveFrom: { type: "string" },
        effectiveTo: { type: ["string", "null"] },
        meta: {
          type: "object",
          additionalProperties: true,
          properties: {
            asOf: { type: ["string", "null"] },
            qualityIssues: { type: "array", items: { type: "string" } },
            source: { type: "object", additionalProperties: true },
          },
          required: ["asOf", "qualityIssues", "source"],
        },
      },
      required: ["security", "effectiveFrom", "effectiveTo", "meta"],
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
  title: "Get Security",
  description: "Read point-in-time security classification and execution metadata from the repository security master. This is read-only and never infers market-specific trading eligibility from a code prefix.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createMarketGetSecurityTool({ useCase } = {}) {
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
  TOOL_DEFINITION,
  TOOL_NAME,
  createMarketGetSecurityTool,
};
