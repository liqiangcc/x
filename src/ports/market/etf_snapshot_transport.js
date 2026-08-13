"use strict";

const ETF_SNAPSHOT_TRANSPORT_METHODS = Object.freeze(["readSnapshot"]);

function assertEtfSnapshotTransport(implementation) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("etfSnapshotTransport implementation must be an object.");
  }
  const missing = ETF_SNAPSHOT_TRANSPORT_METHODS.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`etfSnapshotTransport is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

module.exports = {
  ETF_SNAPSHOT_TRANSPORT_METHODS,
  assertEtfSnapshotTransport,
};
