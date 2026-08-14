"use strict";

function assertStrategyReader(reader) {
  if (!reader || typeof reader.listStrategies !== "function") {
    throw new TypeError("strategyReader implementation must provide listStrategies().");
  }
  return reader;
}

module.exports = {
  assertStrategyReader,
};
