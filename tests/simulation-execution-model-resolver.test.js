"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BUY_EXECUTION_MODEL_IDS,
  BUY_EXECUTION_MODEL_RESOLVER_METHODS,
  DEFAULT_BUY_EXECUTION_MODEL_ID,
  assertBuyExecutionModelResolver,
  normalizeBuyExecutionModelId,
} = require("../src/ports/simulation/buy_execution_model_resolver");
const {
  createBuyExecutionModelResolver,
} = require("../src/simulation/execution/buy_execution_model_resolver");


test("BuyExecutionModelResolver port owns the public model identifiers and narrow resolve contract", () => {
  assert.deepEqual(BUY_EXECUTION_MODEL_IDS, ["legacy_a_share", "frictionless"]);
  assert.deepEqual(BUY_EXECUTION_MODEL_RESOLVER_METHODS, ["resolve"]);
  assert.equal(DEFAULT_BUY_EXECUTION_MODEL_ID, "legacy_a_share");
  assert.equal(normalizeBuyExecutionModelId(), "legacy_a_share");
  assert.equal(normalizeBuyExecutionModelId("frictionless"), "frictionless");
  assert.throws(
    () => normalizeBuyExecutionModelId("unknown"),
    /executionModel must be one of: legacy_a_share, frictionless/
  );
  assert.throws(() => assertBuyExecutionModelResolver(null), /must be an object/);
  assert.throws(() => assertBuyExecutionModelResolver({}), /missing methods: resolve/);
});

test("registered resolver maps stable identifiers to interchangeable execution model implementations", () => {
  const resolver = createBuyExecutionModelResolver();
  assert.equal(assertBuyExecutionModelResolver(resolver), resolver);

  const legacy = resolver.resolve({
    model: "legacy_a_share",
    executionConfig: { lotSize: 10 },
  });
  const frictionless = resolver.resolve({
    model: "frictionless",
    executionConfig: { lotSize: 10 },
  });

  assert.equal(legacy.describe().kind, "legacy_a_share_next_open");
  assert.equal(legacy.describe().lotSize, 10);
  assert.equal(frictionless.describe().kind, "frictionless_next_open");
  assert.equal(frictionless.describe().lotSize, 10);
});

test("registered resolver keeps concrete factories behind one infrastructure mapping", () => {
  const calls = [];
  const model = {
    executeBuy() { return { status: "skipped" }; },
    describe() { return { kind: "fake" }; },
  };
  const resolver = createBuyExecutionModelResolver({
    factories: {
      legacy_a_share(input) {
        calls.push({ id: "legacy_a_share", input });
        return model;
      },
      frictionless(input) {
        calls.push({ id: "frictionless", input });
        return model;
      },
    },
  });

  assert.equal(
    resolver.resolve({ model: "frictionless", executionConfig: { lotSize: 7 } }),
    model
  );
  assert.deepEqual(calls, [{
    id: "frictionless",
    input: { executionConfig: { lotSize: 7 } },
  }]);
});
