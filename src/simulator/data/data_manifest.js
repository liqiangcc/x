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
  const byPath = new Map();
  for (const input of inputs) {
    if (input?.sourcePath && input?.contentHash) {
      byPath.set(input.sourcePath, {
        contentHash: input.contentHash,
        sourcePath: input.sourcePath,
      });
    }
  }
  const files = [...byPath.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
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
