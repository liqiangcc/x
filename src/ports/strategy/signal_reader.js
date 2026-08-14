"use strict";

function assertSignalReader(candidate) {
  if (!candidate || typeof candidate.getStrategyCandidates !== "function") {
    throw new TypeError("signalReader must provide getStrategyCandidates().");
  }
  return candidate;
}

function assertSignalDetailReader(candidate) {
  if (!candidate || typeof candidate.getStrategySignal !== "function") {
    throw new TypeError("signalReader must provide getStrategySignal().");
  }
  return candidate;
}

module.exports = {
  assertSignalDetailReader,
  assertSignalReader,
};
