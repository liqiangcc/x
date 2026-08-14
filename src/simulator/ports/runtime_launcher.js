"use strict";

function assertSimulatorRuntimeLauncher(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("simulatorRuntimeLauncher implementation must be an object.");
  }
  if (typeof implementation.launch !== "function") {
    throw new TypeError("simulatorRuntimeLauncher is missing method: launch");
  }
  return implementation;
}

module.exports = {
  assertSimulatorRuntimeLauncher,
};
