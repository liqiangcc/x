"use strict";

const { ComponentRegistry } = require("./config/component_registry");
const { DEFAULT_SIMULATOR_CONFIG } = require("./config/defaults");
const { SIMULATOR_CONFIG_SCHEMA, normalizeSimulatorConfig } = require("./config/schema");
const contracts = require("./core/contracts");
const enums = require("./core/enums");
const ports = require("./ports");

module.exports = {
  ComponentRegistry,
  DEFAULT_SIMULATOR_CONFIG,
  SIMULATOR_CONFIG_SCHEMA,
  normalizeSimulatorConfig,
  ...contracts,
  ...enums,
  ...ports,
};
