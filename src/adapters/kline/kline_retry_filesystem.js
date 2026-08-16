"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function createFilesystemKlineRetryArtifacts({
  cwd = process.cwd(),
  fsApi = fs,
  tmpdir = os.tmpdir,
} = {}) {
  async function readRetryArtifact(inputPath) {
    const target = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
    return JSON.parse(await fsApi.readFile(target, "utf8"));
  }

  async function createRetryCodesInput(codes) {
    const tempDir = await fsApi.mkdtemp(path.join(tmpdir(), "x-kline-retry-"));
    const codesPath = path.join(tempDir, "codes.json");
    await fsApi.writeFile(codesPath, `${JSON.stringify({ codes }, null, 2)}\n`, "utf8");
    return {
      path: codesPath,
      cleanup: () => fsApi.rm(tempDir, { recursive: true, force: true }),
    };
  }

  return {
    createRetryCodesInput,
    readRetryArtifact,
  };
}

module.exports = {
  createFilesystemKlineRetryArtifacts,
};
