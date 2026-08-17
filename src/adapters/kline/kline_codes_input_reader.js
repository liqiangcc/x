"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { uniqueCodes } = require("../../kline/code_universe");

function relativePath(root, target) {
  return path.relative(root, target).replaceAll(path.sep, "/");
}

function createFilesystemKlineCodesInputReader({
  root,
  fsApi = fs,
  normalizeCodes = uniqueCodes,
} = {}) {
  if (!root) {
    throw new TypeError("kline codes input reader root is required.");
  }
  if (typeof fsApi?.stat !== "function" || typeof fsApi?.readFile !== "function") {
    throw new TypeError("kline codes input reader fsApi must provide stat and readFile.");
  }
  if (typeof normalizeCodes !== "function") {
    throw new TypeError("kline codes input reader normalizeCodes must be a function.");
  }

  return async function readKlineCodesInput(inputPath) {
    if (!inputPath) {
      throw new TypeError("kline codes input path is required.");
    }

    const target = path.isAbsolute(inputPath) ? inputPath : path.join(root, inputPath);
    const stat = await fsApi.stat(target);
    const codesFile = stat.isDirectory() ? path.join(target, "codes.json") : target;
    const payload = JSON.parse(await fsApi.readFile(codesFile, "utf8"));
    if (!Array.isArray(payload?.codes)) {
      throw new Error(`Missing codes array: ${relativePath(root, codesFile)}`);
    }
    return normalizeCodes(payload.codes);
  };
}

module.exports = {
  createFilesystemKlineCodesInputReader,
  relativePath,
};
