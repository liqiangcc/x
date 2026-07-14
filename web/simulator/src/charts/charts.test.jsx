import { describe, expect, it } from "vitest";
import { buildDailyOption } from "./DailyChart.jsx";
import { buildYearlyOption } from "./YearlyChart.jsx";

describe("simulator chart options", () => {
  it("marks a persisted watchlist signal on the daily chart", () => {
    const option = buildDailyOption([
      { close: 10, high: 10, low: 9, open: 9.5 },
      { close: 11, high: 11, low: 10, open: 10, signal: true },
      { close: 12, high: 12, low: 11, open: 11 },
    ]);
    expect(option.series[0].markPoint.data[0]).toMatchObject({ name: "信号日", value: "信号" });
  });
  it("builds daily candlesticks, BOLL, volume, breakout and touch zoom", () => {
    const option = buildDailyOption([{ bollLower: 8, bollMiddle: 10, bollUpper: 12, breakout: true, close: 11, date: "2026-07-01", high: 11.2, low: 9.8, open: 10, previousYearHigh: 10.5, volume: 100 }]);
    expect(option.series.map((series) => series.name)).toEqual(["日线", "BOLL上轨", "BOLL中轨", "BOLL下轨", "成交量"]);
    expect(option.series[0].markLine.data[0].yAxis).toBe(10.5);
    expect(option.series[0].markPoint.data[0].name).toBe("首次突破");
    expect(option.dataZoom[0].type).toBe("inside");
    expect(option.xAxis[0].data).toEqual(["D0"]);
  });

  it("allows the detail toolbar to hide BOLL and volume", () => {
    const option = buildDailyOption([
      { bollLower: 8, bollMiddle: 10, bollUpper: 12, close: 11, high: 11.2, low: 9.8, open: 10, volume: 100 },
    ], { showBoll: false, showVolume: false });
    expect(option.series.slice(1).every((series) => series.data.length === 0)).toBe(true);
    expect(option.grid[0].bottom).toBe(42);
  });

  it("limits the visible daily K-line range for left and right navigation", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ close: index, high: index, low: index, open: index }));
    const option = buildDailyOption(rows, { windowEnd: 29, windowStart: 10 });
    expect(option.dataZoom[0]).toMatchObject({ endValue: 29, startValue: 10 });
    expect(option.dataZoom[1]).toMatchObject({ endValue: 29, startValue: 10 });
  });

  it("builds the separate yearly candlestick view", () => {
    const option = buildYearlyOption([{ close: 14, high: 17, low: 12, open: 16, year: 2025 }]);
    expect(option.xAxis.data).toEqual([""]);
    expect(option.xAxis.axisLabel.show).toBe(false);
    expect(option.series[0].data[0]).toEqual([16, 14, 12, 17]);
  });

  it("shows real years only after anonymous mode is disabled", () => {
    const option = buildYearlyOption([{ year: 2024 }, { year: 2025 }], { anonymousMode: false });
    expect(option.xAxis.data).toEqual(["2024", "2025"]);
    expect(option.xAxis.axisLabel.show).toBe(true);
  });

  it("limits the visible yearly K-line range for left and right navigation", () => {
    const option = buildYearlyOption(Array.from({ length: 15 }, (_, index) => ({ year: 2010 + index })), { windowEnd: 14, windowStart: 5 });
    expect(option.dataZoom[0]).toMatchObject({ endValue: 14, startValue: 5 });
  });
});
