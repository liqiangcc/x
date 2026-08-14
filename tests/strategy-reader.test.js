"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { BuiltinStrategyReader } = require("../src/adapters/strategy/builtin_strategy_reader");
const { ListStrategiesUseCase } = require("../src/application/strategy/list_strategies");
const { assertStrategyReader } = require("../src/ports/strategy/strategy_reader");

test("builtin strategy reader exposes compact catalog descriptors without persistence", async () => {
  const reader = new BuiltinStrategyReader({
    catalog: {
      schemaVersion: 3,
      templates: [{
        id: "example",
        label: "Example",
        description: "Example strategy",
        defaultDefinition: {
          schemaVersion: 3,
          type: "capability_composite",
          indicators: [{ key: "ma", type: "moving_average", params: { period: 20, field: "close" } }],
          rules: [{ key: "rule", type: "value_compare", params: {} }],
        },
      }],
    },
  });

  const compact = await reader.listStrategies();
  assert.deepEqual(compact, {
    strategies: [{
      id: "example",
      name: "Example",
      description: "Example strategy",
      isSystem: true,
      archived: false,
      status: "ready",
      schemaVersion: 3,
      type: "capability_composite",
      indicatorCount: 1,
      ruleCount: 1,
    }],
    source: { kind: "builtin_strategy_catalog", schemaVersion: 3 },
  });

  const detailed = await reader.listStrategies({ includeDefinition: true });
  assert.equal(detailed.strategies[0].definition.schemaVersion, 3);
  assert.equal(detailed.strategies[0].definition.rules.length, 1);
  assert.notEqual(detailed.strategies[0].definition, reader.catalog.templates[0].defaultDefinition);
});

test("list strategies use case depends only on StrategyReader and summarizes the result", async () => {
  const calls = [];
  const useCase = new ListStrategiesUseCase({
    strategyReader: {
      async listStrategies(input) {
        calls.push(input);
        return {
          strategies: [
            { id: "a", isSystem: true, archived: false },
            { id: "b", isSystem: false, archived: true },
          ],
          source: { kind: "fake" },
        };
      },
    },
  });

  const result = await useCase.execute({ includeDefinition: true });
  assert.deepEqual(calls, [{ includeDefinition: true }]);
  assert.deepEqual(result.summary, { count: 2, systemCount: 1, archivedCount: 1 });
  assert.deepEqual(result.meta, { source: { kind: "fake" } });
});

test("StrategyReader boundary validates the port and input without storage concerns", async () => {
  assert.throws(() => assertStrategyReader(null), /strategyReader implementation/);
  assert.throws(() => new ListStrategiesUseCase(), /strategyReader implementation/);
  const reader = new BuiltinStrategyReader({ catalog: { templates: [] } });
  await assert.rejects(() => reader.listStrategies({ includeDefinition: "yes" }), /boolean/);
});
