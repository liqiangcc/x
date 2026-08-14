"use strict";

const { errorPayload, jsonResult } = require("../tool_result");

const TOOL_NAME = "strategy_list";

const INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    includeDefinition: {
      type: "boolean",
      default: false,
      description: "Include each strategy's full immutable built-in definition. Keep false for compact discovery.",
    },
  },
});

const STRATEGY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    isSystem: { type: "boolean" },
    archived: { type: "boolean" },
    status: { type: "string" },
    schemaVersion: { type: ["integer", "null"] },
    type: { type: ["string", "null"] },
    indicatorCount: { type: "integer", minimum: 0 },
    ruleCount: { type: "integer", minimum: 0 },
    definition: { type: "object" },
  },
  required: [
    "id",
    "name",
    "description",
    "isSystem",
    "archived",
    "status",
    "schemaVersion",
    "type",
    "indicatorCount",
    "ruleCount",
  ],
});

const OUTPUT_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        strategies: { type: "array", items: STRATEGY_SCHEMA },
        summary: {
          type: "object",
          additionalProperties: false,
          properties: {
            count: { type: "integer", minimum: 0 },
            systemCount: { type: "integer", minimum: 0 },
            archivedCount: { type: "integer", minimum: 0 },
          },
          required: ["count", "systemCount", "archivedCount"],
        },
        meta: { type: "object" },
      },
      required: ["strategies", "summary", "meta"],
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
  title: "List Strategies",
  description: "List existing built-in strategy definitions through the StrategyReader application boundary. This read-only tool never opens or migrates the simulator database and never evaluates a strategy.",
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function createStrategyListTool({ useCase } = {}) {
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
  STRATEGY_SCHEMA,
  TOOL_DEFINITION,
  TOOL_NAME,
  createStrategyListTool,
};
