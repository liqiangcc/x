"use strict";

const { STRATEGY_BUILDER_CATALOG } = require("../../strategies/strategy_builder");

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class BuiltinStrategyReader {
  constructor({ catalog = STRATEGY_BUILDER_CATALOG } = {}) {
    if (!catalog || !Array.isArray(catalog.templates)) {
      throw new TypeError("catalog must provide templates[].");
    }
    this.catalog = catalog;
  }

  async listStrategies({ includeDefinition = false } = {}) {
    if (typeof includeDefinition !== "boolean") {
      throw new TypeError("includeDefinition must be a boolean.");
    }

    const strategies = this.catalog.templates.map((template) => {
      const definition = template?.defaultDefinition ?? {};
      const item = {
        id: String(template.id),
        name: String(template.label ?? template.id),
        description: template.description ?? null,
        isSystem: true,
        archived: false,
        status: "ready",
        schemaVersion: Number.isInteger(definition.schemaVersion)
          ? definition.schemaVersion
          : (Number.isInteger(this.catalog.schemaVersion) ? this.catalog.schemaVersion : null),
        type: definition.type ?? null,
        indicatorCount: Array.isArray(definition.indicators) ? definition.indicators.length : 0,
        ruleCount: Array.isArray(definition.rules) ? definition.rules.length : 0,
      };
      if (includeDefinition) item.definition = cloneJson(definition);
      return item;
    });

    return {
      strategies,
      source: {
        kind: "builtin_strategy_catalog",
        schemaVersion: Number.isInteger(this.catalog.schemaVersion) ? this.catalog.schemaVersion : null,
      },
    };
  }
}

module.exports = {
  BuiltinStrategyReader,
};
