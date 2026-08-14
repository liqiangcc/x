"use strict";

const {
  CheckSimulatorDataReadinessUseCase,
} = require("../../../simulator/application/check_data_readiness");
const {
  StartSimulatorRuntimeUseCase,
} = require("../../../simulator/application/start_runtime");

const BOOLEAN_OPTIONS = Object.freeze(new Set([
  "latest",
  "commit",
  "force",
  "forcePool",
  "forceUniverse",
  "forceStrategyCodes",
  "strategyOnly",
  "allCodes",
  "json",
  "allowPartial",
  "proxyPreflight",
  "noProxyPreflight",
]));

const SIMULATOR_USAGE = `Usage:
  x simulator start [--host 127.0.0.1] [--port 3001]
  x simulator check --start-date YYYYMMDD --end-date YYYYMMDD [--json]

The simulator reuses data/universe, data/pool and data/kline without modifying them.`;

function parseSimulatorOptions(argv, defaults = {}) {
  const options = { _: [], ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }

    const nextArg = argv[index + 1];
    if (!nextArg) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = nextArg;
    index += 1;
  }
  return options;
}

async function runSimulatorCommand({
  argv = [],
  checkDataReadinessUseCase,
  getCheckDataReadinessUseCase,
  databasePath = "var/simulator/simulator.db",
  getStartRuntimeUseCase,
  startRuntimeUseCase,
  stdout = process.stdout,
} = {}) {
  const subcommand = argv[0] ?? "start";
  if (["--help", "-h", "help"].includes(subcommand)) {
    stdout.write(`${SIMULATOR_USAGE}\n`);
    return;
  }

  const options = parseSimulatorOptions(argv.slice(1));

  if (subcommand === "start") {
    const useCase = startRuntimeUseCase ?? getStartRuntimeUseCase?.();
    if (!useCase || typeof useCase.execute !== "function") {
      throw new TypeError("startRuntimeUseCase must expose execute().");
    }
    return useCase.execute({
      host: options.host ?? "127.0.0.1",
      port: options.port ?? "3001",
    });
  }

  if (subcommand === "check") {
    if (!options.startDate || !options.endDate) {
      throw new Error("simulator check requires --start-date and --end-date");
    }
    const useCase = checkDataReadinessUseCase ?? getCheckDataReadinessUseCase?.();
    if (!useCase || typeof useCase.execute !== "function") {
      throw new TypeError("checkDataReadinessUseCase must expose execute().");
    }

    const check = await useCase.execute({
      startDate: options.startDate,
      endDate: options.endDate,
    });
    const result = {
      dataMode: check.dataMode,
      databasePath,
      qualityIssues: check.qualityIssues,
      tradingDateCount: check.tradingDateCount,
      universeCount: check.universeCount,
      universeSource: check.universeSource,
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      stdout.write(
        `simulator data: ${result.universeCount} securities (${result.universeSource}), ${result.tradingDateCount} trading dates, ${result.dataMode}\n`
      );
    }
    return result;
  }

  throw new Error(`Unknown simulator command: ${subcommand}`);
}

function createSimulatorCommand({
  root,
  klineDir,
  poolDir,
  universeDir,
  databasePath = "var/simulator/simulator.db",
  stdout = process.stdout,
  startRuntimeUseCase,
  checkDataReadinessUseCase,
  runtimeLauncher,
  marketDataRepository,
  universeReader,
  tradingCalendarReader,
} = {}) {
  let resolvedStartUseCase = startRuntimeUseCase;
  let resolvedCheckUseCase = checkDataReadinessUseCase;

  function getStartRuntimeUseCase() {
    if (!resolvedStartUseCase) {
      const {
        createNpmRuntimeLauncher,
      } = require("../../../simulator/adapters/process/npm_runtime_launcher");
      resolvedStartUseCase = new StartSimulatorRuntimeUseCase({
        runtimeLauncher: runtimeLauncher ?? createNpmRuntimeLauncher({ cwd: root }),
      });
    }
    return resolvedStartUseCase;
  }

  function getCheckDataReadinessUseCase() {
    if (!resolvedCheckUseCase) {
      const {
        ExistingKlineRepository,
      } = require("../../../simulator/adapters/ledger/existing_kline_repository");
      const {
        ExistingUniverseRepository,
      } = require("../../../simulator/adapters/ledger/existing_universe");
      const {
        createLegacyTradingCalendarReader,
      } = require("../../../simulator/adapters/ledger/legacy_trading_calendar_reader");
      const resolvedMarketDataRepository = marketDataRepository ?? new ExistingKlineRepository({
        klineRoot: klineDir,
      });
      resolvedCheckUseCase = new CheckSimulatorDataReadinessUseCase({
        universeReader: universeReader ?? new ExistingUniverseRepository({
          klineRoot: klineDir,
          poolRoot: poolDir,
          universeRoot: universeDir,
        }),
        tradingCalendarReader: tradingCalendarReader ?? createLegacyTradingCalendarReader({
          marketDataRepository: resolvedMarketDataRepository,
        }),
      });
    }
    return resolvedCheckUseCase;
  }

  return (argv) => runSimulatorCommand({
    argv,
    checkDataReadinessUseCase,
    getCheckDataReadinessUseCase,
    databasePath,
    getStartRuntimeUseCase,
    startRuntimeUseCase,
    stdout,
  });
}

module.exports = {
  SIMULATOR_USAGE,
  createSimulatorCommand,
  parseSimulatorOptions,
  runSimulatorCommand,
};
