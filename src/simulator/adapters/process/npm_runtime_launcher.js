"use strict";

const { spawn } = require("node:child_process");

function createNpmRuntimeLauncher({
  cwd,
  env = process.env,
  spawnProcess = spawn,
} = {}) {
  if (!cwd) {
    throw new TypeError("simulator runtime cwd is required.");
  }
  if (typeof spawnProcess !== "function") {
    throw new TypeError("spawnProcess must be a function.");
  }

  return {
    launch({ host = "127.0.0.1", port = "3001" } = {}) {
      return new Promise((resolve, reject) => {
        const child = spawnProcess("npm", ["run", "dev:simulator"], {
          cwd,
          env: {
            ...env,
            SIMULATOR_HOST: host,
            SIMULATOR_PORT: port,
          },
          stdio: "inherit",
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`simulator exited with code ${code}`));
        });
      });
    },
  };
}

module.exports = {
  createNpmRuntimeLauncher,
};
