"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ListRunsUseCase,
  ReadRunArtifactUseCase,
  normalizeRunId,
} = require("../src/application/runs/query_runs");

test("ListRunsUseCase returns deterministic unique run ids with only the list port", async () => {
  const useCase = new ListRunsUseCase({
    runReader: {
      async listRunIds() {
        return ["run-b", "run-a", "run-b", ""];
      },
    },
  });

  assert.deepEqual(await useCase.execute(), ["run-a", "run-b"]);
});

test("ReadRunArtifactUseCase delegates normalized inputs with only the artifact port", async () => {
  const calls = [];
  const useCase = new ReadRunArtifactUseCase({
    runReader: {
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

test("run reader contracts are narrow and run id normalization is explicit", () => {
  assert.throws(() => new ListRunsUseCase(), /runListReader implementation/);
  assert.throws(
    () => new ListRunsUseCase({ runReader: { readArtifact() {} } }),
    /listRunIds/
  );
  assert.throws(() => new ReadRunArtifactUseCase(), /runArtifactReader implementation/);
  assert.throws(
    () => new ReadRunArtifactUseCase({ runReader: { listRunIds() {} } }),
    /readArtifact/
  );
  assert.doesNotThrow(
    () => new ListRunsUseCase({ runReader: { listRunIds() { return []; } } })
  );
  assert.doesNotThrow(
    () => new ReadRunArtifactUseCase({ runReader: { readArtifact() { return ""; } } })
  );
  assert.equal(normalizeRunId("run-1"), "run-1");
  assert.throws(() => normalizeRunId(""), /required/);
});
