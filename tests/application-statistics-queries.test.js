"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  QueryNewHighsUseCase,
  QueryYearlyPositiveUseCase,
} = require("../src/application/stats/statistics_queries");

test("yearly positive use case delegates query rows through the narrow port", () => {
  const calls = [];
  const useCase = new QueryYearlyPositiveUseCase({
    sqlRowReader: {
      queryRows(input) {
        calls.push(input);
        return [{ Year: "2024", PositiveCount: 1 }];
      },
    },
  });

  const result = useCase.execute({
    dbFile: "fixture.db",
    metricColumn: "c4",
    stockCode: "000001",
  });

  assert.deepEqual(result, [{ Year: "2024", PositiveCount: 1 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dbFile, "fixture.db");
  assert.deepEqual(calls[0].params, ["000001"]);
  assert.match(calls[0].sql, /LAG\(c4, 1, 0\)/);
});

test("new highs use case delegates deterministic year/date queries", () => {
  const calls = [];
  const useCase = new QueryNewHighsUseCase({
    sqlRowReader: {
      queryRows(input) {
        calls.push(input);
        return [{ Date: "20240102", BreakoutCount: 1 }];
      },
    },
  });

  const result = useCase.execute({ dbFile: "fixture.db", year: "2024" });
  assert.deepEqual(result, [{ Date: "20240102", BreakoutCount: 1 }]);
  assert.deepEqual(calls[0].params, ["2024"]);
  assert.match(calls[0].sql, /BreakoutCount/);
});

test("statistics use cases require only the read-only row reader contract", () => {
  assert.throws(
    () => new QueryYearlyPositiveUseCase({ sqlRowReader: { execute() {} } }),
    /queryRows/
  );
  assert.throws(
    () => new QueryNewHighsUseCase(),
    /sqlRowReader implementation/
  );
});

test("statistics application rejects non-array row results", () => {
  const useCase = new QueryNewHighsUseCase({
    sqlRowReader: {
      queryRows() {
        return { unexpected: true };
      },
    },
  });

  assert.throws(
    () => useCase.execute({ dbFile: "fixture.db" }),
    /queryRows\(\) must return an array/
  );
});
