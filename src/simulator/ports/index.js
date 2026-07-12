"use strict";

const PORT_METHODS = Object.freeze({
  marketDataRepository: Object.freeze([
    "listAvailableCodes",
    "getLegacyBar",
    "getLegacyHistory",
  ]),
  sessionRepository: Object.freeze([
    "createSession",
    "getSession",
    "saveSession",
  ]),
});

function assertPort(name, implementation) {
  const methods = PORT_METHODS[name];
  if (!methods) {
    throw new Error(`Unknown simulator port: ${name}`);
  }
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError(`${name} implementation must be an object.`);
  }
  const missing = methods.filter((method) => typeof implementation[method] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`${name} is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  PORT_METHODS,
  assertPort,
};
