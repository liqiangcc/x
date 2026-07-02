"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatStageLog,
  isStageLogEnabled,
  sanitizeStageDetails,
  stageLog,
} = require("../src/core/stage_log");

test("stage logger is enabled only by explicit flag or GitHub Actions", () => {
  assert.equal(isStageLogEnabled({}), false);
  assert.equal(isStageLogEnabled({ X_STAGE_LOG: "1" }), true);
  assert.equal(isStageLogEnabled({ GITHUB_ACTIONS: "true" }), true);
  assert.equal(isStageLogEnabled({ GITHUB_ACTIONS: "true", X_STAGE_LOG: "0" }), false);
});

test("stage logger formats single-line JSON details", () => {
  const line = formatStageLog(
    "start",
    "kline_sync",
    { period: "daily", total: 2 },
    new Date("2026-07-02T10:00:00.000Z")
  );

  assert.equal(line, '[stage] 2026-07-02T10:00:00.000Z start kline_sync {"period":"daily","total":2}');
});

test("stage logger masks sensitive detail fields", () => {
  assert.deepEqual(
    sanitizeStageDetails({
      api_key: "abc",
      nested: {
        password: "secret",
        safe: "value",
      },
      token: "xyz",
    }),
    {
      api_key: "[masked]",
      nested: {
        password: "[masked]",
        safe: "value",
      },
      token: "[masked]",
    }
  );
});

test("stageLog writes to the provided writer when enabled", () => {
  let output = "";
  stageLog("end", "daily_end", { ok: true }, {
    env: { X_STAGE_LOG: "1" },
    now: new Date("2026-07-02T10:00:00.000Z"),
    writer: {
      write(chunk) {
        output += chunk;
      },
    },
  });

  assert.equal(output, '[stage] 2026-07-02T10:00:00.000Z end daily_end {"ok":true}\n');
});
