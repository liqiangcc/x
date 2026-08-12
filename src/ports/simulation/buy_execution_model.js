"use strict";

const BUY_EXECUTION_MODEL_METHODS = Object.freeze(["executeBuy", "describe"]);

function assertBuyExecutionModel(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("buyExecutionModel implementation must be an object.");
  }
  const missing = BUY_EXECUTION_MODEL_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`buyExecutionModel is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  BUY_EXECUTION_MODEL_METHODS,
  assertBuyExecutionModel,
};
