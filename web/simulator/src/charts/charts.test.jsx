import { describe, expect, it } from "vitest";
import { buildDailyOption } from "./DailyChart.jsx";
import { buildYearlyOption } from "./YearlyChart.jsx";

describe("simulator chart options", () => {
  it("builds daily candlesticks, BOLL, volume, breakout and touch zoom", () => {
    const option = buildDailyOption([{ bollLower: 8, bollMiddle: 10, bollUpper: 12, breakout: true, close: 11, date: "2026-07-01", high: 11.2, low: 9.8, open: 10, previousYearHigh: 10.5, volume: 100 }]);
    expect(option.series.map((series) => series.name)).toEqual(["日线", "BOLL上轨", "BOLL中轨", "BOLL下轨", "成交量"]);
    expect(option.series[0].markLine.data[0].yAxis).toBe(10.5);
    expect(option.series[0].markPoint.data[0].name).toBe("首次突破");
    expect(option.dataZoom[0].type).toBe("inside");
  });

  it("builds the separate yearly candlestick view", () => {
    const option = buildYearlyOption([{ close: 14, high: 17, low: 12, open: 16, year: 2025 }]);
    expect(option.xAxis.data).toEqual(["2025"]);
    expect(option.series[0].data[0]).toEqual([16, 14, 12, 17]);
  });
});
