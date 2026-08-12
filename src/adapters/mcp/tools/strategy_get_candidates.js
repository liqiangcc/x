"use strict";

const { errorPayload, jsonResult } = require("../tool_result");

const TOOL_NAME = "strategy_get_candidates";

const INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    strategyId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Strategy identifier whose latest ready signal build should be queried.",
    },
    date: {
      type: ["string", "null"],
      pattern: "^\\d{4}-?\\d{2}-?\\d{2}$",
      description: "Optional trading date. When omitted, the latest signal date in the latest ready build is used.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 50,
      description: "Maximum number of ranked candidates returned.",
    },
    offset: {
      type: "integer",
      minimum: 0,
      default: 0,
      description: "Zero-based candidate offset for bounded pagination.",
    },
    includeEvidence: {
      type: "boolean",
      default: false,
      description: "Include detailed strategy evidence for each candidate. Keep false for compact discovery.",
    },
  },
  required: ["strategyId"],
});

const BUILD_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    strategyVersion: { type: "integer" },
    dataVersion: { type: "string" },
    algorithmVersion: { type: "integer" },
    status: { type: "string" },
    signalCount: { type: "integer", minimum: 0 },
  },
  required: ["id", "strategyVersion", "dataVersion", "algorithmVersion", "status", "signalCount"],
});

const CANDIDATE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    rank: { type: ["integer", "null"], minimum: 1 },
    securityKey: { type: "string" },
    code: { type: "string" },
    market: { type: "number" },
    rankingValues: {
      type: "array",
      items: { type: ["number", "null"] },
    },
    qualityIssues: {
      type: "array",
      items: { type: "string" },
    },
    evidence: { type: "object" },
  },
  required: ["rank", "securityKey", "code", "market", "rankingValues", "qualityIssues"],
});

const PAGE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    offset: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    returned: { type: "integer", minimum: 0 },
    total: { type: "integer", minimum: 0 },
    hasMore: { type: "boolean" },
    nextOffset: { type: ["integer", "null"], minimum: 0 },
  },
  required: ["offset", "limit", "returned", "total", "hasMore", "nextOffset"],
});

const OUTPUT_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["ready", "not_built"] },
        strategyId: { type: "string" },
        date: { type: ["string", "null"] },
        build: { oneOf: [BUILD_SCHEMA, { type: "null" }] },
        candidates: { type: "array", items: CANDIDATE_SCHEMA },
        page: PAGE_SCHEMA,
        meta: { type: "object" },
      },
      required: ["status", "strategyId", "date", "build", "candidates", "page", "meta"],
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
  title: "Get Strategy Candidates",
  description: "Read ranked candidates from the latest ready strategy signal build through the SignalReader boundary. This tool is read-only and never evaluates, rebuilds, migrates, or writes strategy data.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createStrategyGetCandidatesTool({ useCase } = {}) {
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
  BUILD_SCHEMA,
  CANDIDATE_SCHEMA,
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  PAGE_SCHEMA,
  TOOL_DEFINITION,
  TOOL_NAME,
  createStrategyGetCandidatesTool,
};
