"use strict";

const crypto = require("node:crypto");
const { DataMode } = require("../core/enums");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function createDataManifest({ asOfDate, universe, inputs = [] }) {
  const files = inputs
    .filter((input) => input?.sourcePath && input?.contentHash)
    .map((input) => ({
      contentHash: input.contentHash,
      sourcePath: input.sourcePath,
    }))
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const manifest = {
    asOfDate,
    dataMode: DataMode.LEGACY_APPROXIMATE,
    universe: {
      source: universe?.source ?? null,
      validCount: universe?.coverage?.validCount ?? 0,
    },
    files,
  };
  return {
    ...manifest,
    manifestHash: crypto.createHash("sha256").update(stableStringify(manifest)).digest("hex"),
  };
}

module.exports = {
  createDataManifest,
  stableStringify,
};
