"use strict";

function assertFunction(value, field) {
  if (typeof value !== "function") {
    throw new TypeError(`${field} must be a function.`);
  }
  return value;
}

function normalizeNodeVersion(value) {
  const version = String(value ?? "").trim().replace(/^v/, "");
  if (!/^\d+(?:\.\d+){0,2}$/.test(version)) {
    throw new TypeError("runtimeNodeVersion must be a semantic Node version.");
  }
  return version;
}

function firstOutputLine(stdout) {
  return (String(stdout ?? "").split("\n")[0] || "ok").trim();
}

class CheckRuntimeHealthUseCase {
  constructor({ runTool, runtimeNodeVersion, requiredNodeMajor = 22 } = {}) {
    this.runTool = assertFunction(runTool, "runTool");
    this.runtimeNodeVersion = normalizeNodeVersion(runtimeNodeVersion);
    this.requiredNodeMajor = Number(requiredNodeMajor);
    if (!Number.isInteger(this.requiredNodeMajor) || this.requiredNodeMajor < 1) {
      throw new TypeError("requiredNodeMajor must be a positive integer.");
    }
  }

  async execute() {
    const checks = [];
    for (const [name, args] of [["node", ["--version"]], ["git", ["--version"]]]) {
      try {
        const result = await this.runTool({ args, name });
        checks.push({ name, ok: true, output: firstOutputLine(result?.stdout) });
      } catch (error) {
        checks.push({ name, ok: false, error: error?.message ?? String(error) });
      }
    }

    const runtimeNodeMajor = Number(this.runtimeNodeVersion.split(".")[0]);
    return {
      checks,
      failedCount: checks.filter((item) => !item.ok).length,
      runtime: {
        nodeVersion: this.runtimeNodeVersion,
        requiredNodeMajor: this.requiredNodeMajor,
        supported: runtimeNodeMajor >= this.requiredNodeMajor,
      },
    };
  }
}

module.exports = {
  CheckRuntimeHealthUseCase,
  firstOutputLine,
  normalizeNodeVersion,
};
