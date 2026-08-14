"use strict";

const { errorPayload, jsonResult } = require("../tool_result");
const { BUILD_SCHEMA, CANDIDATE_SCHEMA } = require("./strategy_signal_schemas");

const TOOL_NAME = "strategy_explain_signal";

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
      type: "string",
      pattern: "^\\d{4}-?\\d{2}-?\\d{2}$",
      description: "Exact trading date of the candidate signal.",
    },
    securityKey: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "Exact candidate security key, for example 1.600001.",
    },
  },
  required: ["strategyId", "date", "securityKey"],
});

const EXPLAIN_CANDIDATE_SCHEMA = Object.freeze({
  ...CANDIDATE_SCHEMA,
  required: Object.freeze([...CANDIDATE_SCHEMA.required, "evidence"]),
});

const OUTPUT_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["ready", "not_built", "not_found"] },
        strategyId: { type: "string" },
        date: { type: "string" },
        securityKey: { type: "string" },
        build: { oneOf: [BUILD_SCHEMA, { type: "null" }] },
        candidate: { oneOf: [EXPLAIN_CANDIDATE_SCHEMA, { type: "null" }] },
        meta: { type: "object" },
      },
      required: ["status", "strategyId", "date", "securityKey", "build", "candidate", "meta"],
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
  title: "Explain Strategy Signal",
  description: "Read one exact strategy signal candidate with its stored evidence, rule results, ranking values, and quality issues. This read-only tool never re-evaluates, rebuilds, migrates, or writes strategy data.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createStrategyExplainSignalTool({ useCase } = {}) {
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
  EXPLAIN_CANDIDATE_SCHEMA,
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  TOOL_DEFINITION,
  TOOL_NAME,
  createStrategyExplainSignalTool,
};
