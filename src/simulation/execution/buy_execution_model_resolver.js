"use strict";

const { assertBuyExecutionModel } = require("../../ports/simulation/buy_execution_model");
const {
  BUY_EXECUTION_MODEL_IDS,
  DEFAULT_BUY_EXECUTION_MODEL_ID,
  normalizeBuyExecutionModelId,
} = require("../../ports/simulation/buy_execution_model_resolver");
const {
  assertExecutionProfile,
} = require("../../ports/simulation/execution_profile");
const {
  DEFAULT_EXECUTION_PROFILE_CATALOG,
} = require("./execution_profile_catalog");
const { createFrictionlessBuyExecutionModel } = require("./frictionless_buy_execution_model");
const { createProfiledBuyExecutionModel } = require("./profiled_buy_execution_model");

const DEFAULT_BUY_EXECUTION_MODEL_FACTORIES = Object.freeze({
  frictionless: createFrictionlessBuyExecutionModel,
});

function normalizeProfileCatalog(profileCatalog) {
  if (!profileCatalog || typeof profileCatalog !== "object") {
    throw new TypeError("executionProfileCatalog must be an object.");
  }
  for (const method of ["get", "list"]) {
    if (typeof profileCatalog[method] !== "function") {
      throw new TypeError(`executionProfileCatalog is missing method: ${method}.`);
    }
  }
  return profileCatalog;
}

function normalizeFactories(factories) {
  if (!factories || typeof factories !== "object" || Array.isArray(factories)) {
    throw new TypeError("buyExecutionModel factories must be an object.");
  }
  return factories;
}

function normalizeResolvedExecutionProfile({ model, executionProfile } = {}) {
  if (executionProfile === undefined) return null;
  if (model === "frictionless") {
    throw new TypeError("executionProfile cannot be provided for frictionless execution.");
  }
  const profile = assertExecutionProfile(executionProfile);
  if (profile.id !== model) {
    throw new TypeError(`executionProfile.id must match executionModel: ${model}.`);
  }
  return profile;
}

function assertModelCoverage({ profileCatalog, factories }) {
  for (const id of BUY_EXECUTION_MODEL_IDS) {
    if (profileCatalog.get(id)) continue;
    if (typeof factories[id] !== "function") {
      throw new TypeError(`buyExecutionModel implementation is missing for: ${id}.`);
    }
  }
}

function createBuyExecutionModelResolver({
  profileCatalog = DEFAULT_EXECUTION_PROFILE_CATALOG,
  factories = DEFAULT_BUY_EXECUTION_MODEL_FACTORIES,
} = {}) {
  const resolvedProfileCatalog = normalizeProfileCatalog(profileCatalog);
  const resolvedFactories = normalizeFactories(factories);
  assertModelCoverage({ profileCatalog: resolvedProfileCatalog, factories: resolvedFactories });

  return Object.freeze({
    resolve({
      model = DEFAULT_BUY_EXECUTION_MODEL_ID,
      executionProfile,
      executionConfig = {},
    } = {}) {
      const normalizedModel = normalizeBuyExecutionModelId(model);
      const resolvedExecutionProfile = normalizeResolvedExecutionProfile({
        model: normalizedModel,
        executionProfile,
      });
      if (resolvedExecutionProfile) {
        return assertBuyExecutionModel(
          createProfiledBuyExecutionModel({
            profile: resolvedExecutionProfile,
            executionConfig,
          })
        );
      }

      const profile = resolvedProfileCatalog.get(normalizedModel);
      if (profile) {
        return assertBuyExecutionModel(
          createProfiledBuyExecutionModel({ profile, executionConfig })
        );
      }
      return assertBuyExecutionModel(
        resolvedFactories[normalizedModel]({ executionConfig })
      );
    },
  });
}

module.exports = {
  DEFAULT_BUY_EXECUTION_MODEL_FACTORIES,
  assertModelCoverage,
  createBuyExecutionModelResolver,
  normalizeFactories,
  normalizeProfileCatalog,
  normalizeResolvedExecutionProfile,
};
