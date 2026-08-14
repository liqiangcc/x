"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CheckSimulatorDataReadinessUseCase,
} = require("../src/simulator/application/check_data_readiness");
const {
  StartSimulatorRuntimeUseCase,
} = require("../src/simulator/application/start_runtime");

test("simulator data readiness use case orchestrates only narrow read capabilities", async () => {
  const calls = [];
  const useCase = new CheckSimulatorDataReadinessUseCase({
    universeReader: {
      async listAvailableCodes(input) {
        calls.push(["universe", input]);
        return {
          qualityIssues: ["universe_approximation", "shared_issue"],
          securities: [{ code: "000001" }, { code: "600000" }],
          source: "fixture",
        };
      },
    },
    tradingCalendarReader: {
      async readCalendar(input) {
        calls.push(["calendar", input]);
        return {
          dates: ["2026-01-05", "2026-01-06"],
          qualityIssues: ["trading_calendar_approximation", "shared_issue"],
        };
      },
    },
  });

  const result = await useCase.execute({
    startDate: "20260105",
    endDate: "20260106",
  });

  assert.deepEqual(calls, [
    ["universe", { asOfDate: "20260105" }],
    ["calendar", { startDate: "20260105", endDate: "20260106" }],
  ]);
  assert.deepEqual(result, {
    dataMode: "legacy_approximate",
    qualityIssues: [
      "shared_issue",
      "trading_calendar_approximation",
      "universe_approximation",
    ],
    tradingDateCount: 2,
    universeCount: 2,
    universeSource: "fixture",
  });
});

test("simulator runtime start use case delegates lifecycle control to launcher", async () => {
  const calls = [];
  const useCase = new StartSimulatorRuntimeUseCase({
    runtimeLauncher: {
      async launch(input) {
        calls.push(input);
        return "closed";
      },
    },
  });

  assert.equal(
    await useCase.execute({ host: "0.0.0.0", port: "3100" }),
    "closed"
  );
  assert.deepEqual(calls, [{ host: "0.0.0.0", port: "3100" }]);
});

test("simulator application contracts reject missing capabilities", () => {
  assert.throws(
    () => new CheckSimulatorDataReadinessUseCase({
      universeReader: {},
      tradingCalendarReader: { readCalendar() {} },
    }),
    /simulatorUniverseReader is missing method: listAvailableCodes/
  );
  assert.throws(
    () => new CheckSimulatorDataReadinessUseCase({
      universeReader: { listAvailableCodes() {} },
      tradingCalendarReader: {},
    }),
    /tradingCalendarReader is missing method: readCalendar/
  );
  assert.throws(
    () => new StartSimulatorRuntimeUseCase({ runtimeLauncher: {} }),
    /simulatorRuntimeLauncher is missing method: launch/
  );
});
