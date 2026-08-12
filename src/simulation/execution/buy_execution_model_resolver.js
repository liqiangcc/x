"use strict";

const { assertBuyExecutionModel } = require("../../ports/simulation/buy_execution_model");
const {
  BUY_EXECUTION_MODEL_IDS,
  DEFAULT_BUY_EXECUTION_MODEL_ID,
  normalizeBuyExecutionModelId,
} = require("../../ports/simulation/buy_execution_model_resolver");
const { createFrictionlessBuyExecutionModel } = require("./frictionless_buy_execution_model");
const { createLegacyBuyExecutionModel } = require("./legacy_buy_execution_model");

const DEFAULT_BUY_EXECUTION_MODEL_FACTORIES = Object.freeze({
  legacy_a_share: createLegacyBuyExecutionModel,
  frictionless: createFrictionlessBuyExecutionModel,
});

function normalizeFactories(factories) {
  if (!factories || typeof factories !== "object" || Array.isArray(factories)) {
    throw new TypeError("buyExecutionModel factories must be an object.");
  }
  for (const id of BUY_EXECUTION_MODEL_IDS) {
    if (typeof factories[id] !== "function") {
      throw new TypeError(`buyExecutionModel factory is missing for: ${id}.`);
    }
  }
  return factories;
}

function createBuyExecutionModelResolver({
  factories = DEFAULT_BUY_EXECUTION_MODEL_FACTORIES,
} = {}) {
  const resolvedFactories = normalizeFactories(factories);
  return Object.freeze({
    resolve({
      model = DEFAULT_BUY_EXECUTION_MODEL_ID,
      executionConfig = {},
    } = {}) {
      const normalizedModel = normalizeBuyExecutionModelId(model);
      return assertBuyExecutionModel(
        resolvedFactories[normalizedModel]({ executionConfig })
      );
    },
  });
}

module.exports = {
  DEFAULT_BUY_EXECUTION_MODEL_FACTORIES,
  createBuyExecutionModelResolver,
  normalizeFactories,
};
