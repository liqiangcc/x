"use strict";

const {
  assertSimulatorUniverseReader,
  assertTradingCalendarReader,
} = require("../ports/data_preflight");

class CheckSimulatorDataReadinessUseCase {
  constructor({ universeReader, tradingCalendarReader }) {
    this.universeReader = assertSimulatorUniverseReader(universeReader);
    this.tradingCalendarReader = assertTradingCalendarReader(tradingCalendarReader);
  }

  async execute({ startDate, endDate }) {
    const universe = await this.universeReader.listAvailableCodes({
      asOfDate: startDate,
    });
    const calendar = await this.tradingCalendarReader.readCalendar({
      startDate,
      endDate,
    });

    return {
      dataMode: "legacy_approximate",
      qualityIssues: [
        ...new Set([
          ...(universe.qualityIssues ?? []),
          ...(calendar.qualityIssues ?? []),
        ]),
      ].sort(),
      tradingDateCount: (calendar.dates ?? []).length,
      universeCount: (universe.securities ?? []).length,
      universeSource: universe.source,
    };
  }
}

module.exports = {
  CheckSimulatorDataReadinessUseCase,
};
