"use strict";

const DEFAULT_BUY_EXECUTION_MODEL_ID = "legacy_a_share";
const BUY_EXECUTION_MODEL_IDS = Object.freeze([
  "legacy_a_share",
  "domestic_stock_etf",
  "t0_etf",
  "frictionless",
]);
const BUY_EXECUTION_MODEL_RESOLVER_METHODS = Object.freeze(["resolve"]);

function normalizeBuyExecutionModelId(value = DEFAULT_BUY_EXECUTION_MODEL_ID) {
  const normalized = String(value ?? DEFAULT_BUY_EXECUTION_MODEL_ID);
  if (!BUY_EXECUTION_MODEL_IDS.includes(normalized)) {
    throw new TypeError(`executionModel must be one of: ${BUY_EXECUTION_MODEL_IDS.join(", ")}.`);
  }
  return normalized;
}

function assertBuyExecutionModelResolver(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("buyExecutionModelResolver implementation must be an object.");
  }
  const missing = BUY_EXECUTION_MODEL_RESOLVER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`buyExecutionModelResolver is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  BUY_EXECUTION_MODEL_IDS,
  BUY_EXECUTION_MODEL_RESOLVER_METHODS,
  DEFAULT_BUY_EXECUTION_MODEL_ID,
  assertBuyExecutionModelResolver,
  normalizeBuyExecutionModelId,
};
