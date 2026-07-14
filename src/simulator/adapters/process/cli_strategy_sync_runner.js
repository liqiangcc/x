"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function splitLines(onLine) {
  let buffered = "";
  return {
    push(chunk) {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      lines.filter(Boolean).forEach(onLine);
    },
    flush() {
      if (buffered) onLine(buffered);
      buffered = "";
    },
  };
}

class CliStrategySyncRunner {
  constructor({
    concurrency = process.env.SIMULATOR_SYNC_CONCURRENCY,
    engine = process.env.SIMULATOR_SYNC_ENGINE ?? "auto",
    cnFastThreshold = process.env.SIMULATOR_SYNC_CN_FAST_THRESHOLD,
    root = path.resolve(__dirname, "../../../.."),
    spawnImpl = spawn,
  } = {}) {
    this.concurrency = positiveInteger(concurrency, 4);
    this.engine = engine;
    this.cnFastThreshold = positiveInteger(cnFastThreshold, 500);
    this.root = root;
    this.spawnImpl = spawnImpl;
  }

  run({ downTransitions = 3, marketBoards = null, onStage = () => {}, strategyId }) {
    const marketBoardArgs = Array.isArray(marketBoards) ? ["--strategy-boards", marketBoards.join(",")] : [];
    const args = [
      path.join(this.root, "bin", "x"),
      "daily",
      "--latest",
      "--period", "daily",
      "--strategy-id", strategyId,
      "--strategy-down-transitions", String(downTransitions),
      ...marketBoardArgs,
      "--engine", this.engine,
      "--cn-fast-threshold", String(this.cnFastThreshold),
      "--job-mode", "single",
      "--concurrency", String(this.concurrency),
    ];
    return new Promise((resolve, reject) => {
      let runId = null;
      const child = this.spawnImpl(process.execPath, args, {
        cwd: this.root,
        env: { ...process.env, X_STAGE_LOG: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = [];
      const consume = (line) => {
        if (line.startsWith("[stage] ")) {
          onStage(line);
          const match = line.match(/\s(?:end|error)\sdaily_end\s+(\{.*\})$/);
          if (match) {
            try { runId = JSON.parse(match[1]).run_id ?? runId; } catch {}
          }
        }
        else if (stdout.length < 200) stdout.push(line);
      };
      const stdoutLines = splitLines(consume);
      const stderrLines = splitLines(consume);
      child.stdout.on("data", (chunk) => stdoutLines.push(chunk));
      child.stderr.on("data", (chunk) => stderrLines.push(chunk));
      child.on("error", reject);
      child.on("close", async (exitCode) => {
        stdoutLines.flush();
        stderrLines.flush();
        let updatedCodes = [];
        if (runId && /^[A-Za-z0-9._-]+$/.test(runId)) {
          try {
            const payload = JSON.parse(await fs.readFile(path.join(this.root, "runs", runId, "updated-codes.json"), "utf8"));
            updatedCodes = Array.isArray(payload?.codes) ? payload.codes.map(String) : [];
          } catch {}
        }
        resolve({ exitCode: exitCode ?? 1, output: stdout.slice(-20), runId, updatedCodes });
      });
    });
  }
}

module.exports = {
  CliStrategySyncRunner,
  positiveInteger,
  splitLines,
};
