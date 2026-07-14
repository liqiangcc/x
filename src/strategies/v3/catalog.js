"use strict";

const { createBuiltinRegistries } = require("./builtins");
const { toV3Definition } = require("./migrate");

function publicDescriptor(descriptor) {
  return {
    id: descriptor.id,
    label: descriptor.label,
    outputs: descriptor.outputs ?? [],
    paramSchema: descriptor.paramSchema ?? {},
  };
}

function createStrategyCatalog(registries = createBuiltinRegistries()) {
  const features = registries.features.list();
  return Object.freeze({
    features: features.filter((item) => item.valueType === "number").map(publicDescriptor),
    booleanFeatures: features.filter((item) => item.valueType === "boolean").map(publicDescriptor),
    indicators: registries.indicators.list().map(publicDescriptor),
    limits: { indicators: 20, lookback: 500, rules: 30 },
    rules: registries.rules.list().map(publicDescriptor),
    schemaVersion: 3,
  });
}

function v3Templates(legacyTemplates) {
  return legacyTemplates.map((template) => ({
    ...template,
    defaultDefinition: toV3Definition(template.defaultDefinition),
  }));
}

module.exports = { createStrategyCatalog, v3Templates };
