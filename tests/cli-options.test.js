"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_BOOLEAN_OPTIONS,
  parseCliOptions,
} = require("../src/adapters/cli/options");

test("shared CLI option parser preserves defaults, positional args, booleans, and camelCase keys", () => {
  assert.deepEqual(
    parseCliOptions([
      "item",
      "--json",
      "--start-date",
      "20260105",
      "--proxy-preflight",
      "tail",
    ], {
      defaults: { db: "default.db" },
    }),
    {
      _: ["item", "tail"],
      db: "default.db",
      json: true,
      startDate: "20260105",
      proxyPreflight: true,
    }
  );
});

test("shared CLI option parser preserves last-value-wins behavior", () => {
  assert.deepEqual(
    parseCliOptions(["--db", "one.db", "--db", "two.db"]),
    { _: [], db: "two.db" }
  );
});

test("shared CLI option parser preserves exact missing-value error", () => {
  assert.throws(
    () => parseCliOptions(["--db"]),
    new Error("Missing value for --db")
  );
});

test("shared CLI option parser preserves legacy option-looking value behavior", () => {
  assert.deepEqual(
    parseCliOptions(["--sql", "--json"]),
    { _: [], sql: "--json" }
  );
});

test("shared CLI option parser supports an explicitly narrowed boolean set", () => {
  const booleanOptions = new Set(["dryRun"]);
  assert.deepEqual(
    parseCliOptions(["--dry-run", "--json", "yes"], { booleanOptions }),
    { _: [], dryRun: true, json: "yes" }
  );
  assert.equal(DEFAULT_BOOLEAN_OPTIONS.has("json"), true);
});
