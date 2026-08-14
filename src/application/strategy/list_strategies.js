"use strict";

const { assertStrategyReader } = require("../../ports/strategy/strategy_reader");

class ListStrategiesUseCase {
  constructor({ strategyReader } = {}) {
    this.strategyReader = assertStrategyReader(strategyReader);
  }

  async execute({ includeDefinition = false } = {}) {
    if (typeof includeDefinition !== "boolean") {
      throw new TypeError("includeDefinition must be a boolean.");
    }
    const result = await this.strategyReader.listStrategies({ includeDefinition });
    const strategies = Array.isArray(result?.strategies) ? result.strategies : [];
    return {
      strategies,
      summary: {
        count: strategies.length,
        systemCount: strategies.filter((item) => item?.isSystem === true).length,
        archivedCount: strategies.filter((item) => item?.archived === true).length,
      },
      meta: {
        source: result?.source ?? null,
      },
    };
  }
}

module.exports = {
  ListStrategiesUseCase,
};
