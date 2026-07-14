"use strict";

const Ajv2020 = require("ajv/dist/2020");
const {
  DataModeValues,
  OrderTypeValues,
  SessionModeValues,
} = require("../core/enums");
const { DEFAULT_SIMULATOR_CONFIG } = require("./defaults");

const SIMULATOR_CONFIG_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["version", "session", "data", "selection", "execution", "risk", "privacy"],
  properties: {
    version: { const: 1 },
    session: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "initialCashYuan"],
      properties: {
        mode: { enum: SessionModeValues },
        initialCashYuan: { type: "number", exclusiveMinimum: 0 },
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        randomSeed: { type: "integer" },
      },
    },
    data: {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: { enum: DataModeValues },
      },
    },
    selection: {
      type: "object",
      additionalProperties: false,
      required: ["strategy", "excludeSpecialTreatment", "orderBy", "limit", "universe"],
      properties: {
        strategy: {
          type: "object",
          additionalProperties: false,
          required: ["type", "downTransitions", "requireConsecutiveCalendarYears", "firstBreakoutScope", "breakoutOperator"],
          properties: {
            type: { const: "year_decline_close_breakout" },
            downTransitions: { type: "integer", minimum: 1 },
            requireConsecutiveCalendarYears: { type: "boolean" },
            firstBreakoutScope: { const: "current_year" },
            breakoutOperator: { const: "gt" },
          },
        },
        excludeSpecialTreatment: { type: "boolean" },
        orderBy: { const: "breakout_margin_ascending" },
        limit: { type: "integer", minimum: 1 },
        universe: {
          type: "object",
          additionalProperties: false,
          required: ["mainBoard", "chiNext", "starMarket", "beijingExchange"],
          properties: {
            mainBoard: { type: "boolean" },
            chiNext: { type: "boolean" },
            starMarket: { type: "boolean" },
            beijingExchange: { type: "boolean" },
          },
        },
      },
    },
    execution: {
      type: "object",
      additionalProperties: false,
      required: ["orderType", "slippageRate", "commissionRate", "minimumCommissionYuan", "stampDutyRate", "lotSize", "tPlusOne"],
      properties: {
        orderType: { enum: OrderTypeValues },
        slippageRate: { type: "number", minimum: 0 },
        commissionRate: { type: "number", minimum: 0 },
        minimumCommissionYuan: { type: "number", minimum: 0 },
        stampDutyRate: { type: "number", minimum: 0 },
        lotSize: { type: "integer", minimum: 1 },
        tPlusOne: { type: "boolean" },
      },
    },
    risk: {
      type: "object",
      additionalProperties: false,
      required: ["enforcement", "rules"],
      properties: {
        enforcement: { enum: ["warning", "reject"] },
        rules: { type: "array", items: { type: "object" } },
      },
    },
    privacy: {
      type: "object",
      additionalProperties: false,
      required: ["anonymousByDefault", "blindModeReveal"],
      properties: {
        anonymousByDefault: { type: "boolean" },
        blindModeReveal: { const: "session_end" },
      },
    },
  },
});

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(SIMULATOR_CONFIG_SCHEMA);

function clone(value) {
  return structuredClone(value);
}

function mergeObject(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base?.[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      result[key] = mergeObject(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function normalizeSimulatorConfig(input = {}) {
  const config = mergeObject(clone(DEFAULT_SIMULATOR_CONFIG), clone(input));
  if (!validate(config)) {
    const error = new TypeError("Invalid simulator configuration.");
    error.code = "invalid_simulator_config";
    error.issues = clone(validate.errors ?? []);
    throw error;
  }
  return config;
}

module.exports = {
  SIMULATOR_CONFIG_SCHEMA,
  normalizeSimulatorConfig,
};
