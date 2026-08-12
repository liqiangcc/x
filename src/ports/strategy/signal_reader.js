"use strict";

function assertSignalReader(candidate) {
  if (!candidate || typeof candidate.getStrategyCandidates !== "function") {
    throw new TypeError("signalReader must provide getStrategyCandidates().");
  }
  return candidate;
}

module.exports = {
  assertSignalReader,
};
