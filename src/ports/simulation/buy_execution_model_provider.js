"use strict";

const BUY_EXECUTION_MODEL_PROVIDER_METHODS = Object.freeze(["resolveForBuy"]);

function assertBuyExecutionModelProvider(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("buyExecutionModelProvider implementation must be an object.");
  }
  const missing = BUY_EXECUTION_MODEL_PROVIDER_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`buyExecutionModelProvider is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  BUY_EXECUTION_MODEL_PROVIDER_METHODS,
  assertBuyExecutionModelProvider,
};
