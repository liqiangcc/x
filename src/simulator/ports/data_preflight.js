"use strict";

function assertMethod(implementation, method, label) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError(`${label} implementation must be an object.`);
  }
  if (typeof implementation[method] !== "function") {
    throw new TypeError(`${label} is missing method: ${method}`);
  }
  return implementation;
}

function assertSimulatorUniverseReader(implementation) {
  return assertMethod(
    implementation,
    "listAvailableCodes",
    "simulatorUniverseReader"
  );
}

function assertTradingCalendarReader(implementation) {
  return assertMethod(
    implementation,
    "readCalendar",
    "tradingCalendarReader"
  );
}

module.exports = {
  assertSimulatorUniverseReader,
  assertTradingCalendarReader,
};
