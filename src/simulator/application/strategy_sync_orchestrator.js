"use strict";

const { randomUUID } = require("node:crypto");
const { CliStrategySyncRunner } = require("../adapters/process/cli_strategy_sync_runner");

function conflict(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function publicJob(job) {
  if (!job) return null;
  const { strategyDefinition, ...visible } = job;
  void strategyDefinition;
  return JSON.parse(JSON.stringify(visible));
}

class StrategySyncOrchestrator {
  constructor({ runner = new CliStrategySyncRunner() } = {}) {
    this.jobs = new Map();
    this.latestByStrategy = new Map();
    this.runner = runner;
    this.runningJobId = null;
  }

  list() {
    return [...this.jobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(publicJob);
  }

  latest(strategyId) {
    return publicJob(this.jobs.get(this.latestByStrategy.get(strategyId)));
  }

  start({ afterSync = async () => {}, downTransitions = 3, marketBoards = null, strategyDefinition = null, strategyId }) {
    if (this.runningJobId) throw conflict("strategy_sync_running", "Another strategy data sync is already running.");
    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      strategyId,
      strategyDefinition,
      downTransitions,
      marketBoards,
      status: "queued",
      phase: "queued",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
      exitCode: null,
      error: null,
      stages: [],
    };
    this.jobs.set(job.id, job);
    this.latestByStrategy.set(strategyId, job.id);
    this.runningJobId = job.id;
    queueMicrotask(() => void this.#execute(job, afterSync));
    return publicJob(job);
  }

  async #execute(job, afterSync) {
    job.status = "running";
    job.phase = "syncing_data";
    job.startedAt = new Date().toISOString();
    job.updatedAt = job.startedAt;
    try {
      const result = await this.runner.run({
        downTransitions: job.downTransitions,
        marketBoards: job.marketBoards,
        strategyId: job.strategyId,
        strategyDefinition: job.strategyDefinition,
        onStage: (line) => {
          job.stages.push(line);
          job.stages = job.stages.slice(-12);
          job.updatedAt = new Date().toISOString();
        },
      });
      job.exitCode = result.exitCode;
      if (result.exitCode !== 0) throw new Error(result.output.at(-1) ?? `Data sync exited with code ${result.exitCode}.`);
      job.phase = "rebuilding_strategy";
      job.updatedAt = new Date().toISOString();
      await afterSync(result);
      job.status = "completed";
      job.phase = "completed";
    } catch (error) {
      job.status = "failed";
      job.phase = "failed";
      job.error = error.message;
    } finally {
      job.finishedAt = new Date().toISOString();
      job.updatedAt = job.finishedAt;
      if (this.runningJobId === job.id) this.runningJobId = null;
      while (this.jobs.size > 50) this.jobs.delete(this.jobs.keys().next().value);
    }
  }
}

module.exports = {
  StrategySyncOrchestrator,
  conflict,
  publicJob,
};
