"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ListRunsUseCase,
  ReadRunArtifactUseCase,
  normalizeRunId,
} = require("../src/application/runs/query_runs");

test("ListRunsUseCase returns deterministic unique run ids", async () => {
  const useCase = new ListRunsUseCase({
    runReader: {
      async listRunIds() {
        return ["run-b", "run-a", "run-b", ""];
      },
      async readArtifact() {
        throw new Error("not used");
      },
    },
  });

  assert.deepEqual(await useCase.execute(), ["run-a", "run-b"]);
});

test("ReadRunArtifactUseCase delegates only normalized domain inputs", async () => {
  const calls = [];
  const useCase = new ReadRunArtifactUseCase({
    runReader: {
      async listRunIds() {
        return [];
      },
      async readArtifact(input) {
        calls.push(input);
        return "{\"status\":\"completed\"}\n";
      },
    },
  });

  const content = await useCase.execute({ artifact: "run", runId: " 20260814T120000Z_daily " });
  assert.equal(content, "{\"status\":\"completed\"}\n");
  assert.deepEqual(calls, [{ artifact: "run", runId: "20260814T120000Z_daily" }]);
});

test("ReadRunArtifactUseCase rejects unsupported artifacts and path traversal before IO", async () => {
  let called = false;
  const useCase = new ReadRunArtifactUseCase({
    runReader: {
      async listRunIds() {
        return [];
      },
      async readArtifact() {
        called = true;
        return "";
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({ artifact: "quality", runId: "run-a" }),
    /artifact must be one of/
  );
  await assert.rejects(
    () => useCase.execute({ artifact: "run", runId: "../outside" }),
    /unsupported path characters/
  );
  assert.equal(called, false);
});

test("run reader contract and run id normalization are explicit", () => {
  assert.throws(() => new ListRunsUseCase(), /runReader implementation/);
  assert.throws(
    () => new ReadRunArtifactUseCase({ runReader: { listRunIds() {} } }),
    /readArtifact/
  );
  assert.equal(normalizeRunId("run-1"), "run-1");
  assert.throws(() => normalizeRunId(""), /required/);
});
