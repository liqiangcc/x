"use strict";

const KLINE_READER_METHODS = Object.freeze(["readRange"]);

function assertKlineReader(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("klineReader implementation must be an object.");
  }
  const missing = KLINE_READER_METHODS.filter((method) => typeof implementation[method] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`klineReader is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  KLINE_READER_METHODS,
  assertKlineReader,
};
