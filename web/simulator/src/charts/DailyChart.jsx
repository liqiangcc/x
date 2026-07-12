import { useMemo } from "react";
import useEChart from "./useEChart.js";

export function buildDailyOption(rows = []) {
  const dates = rows.map((row) => row.date);
  const breakout = rows.find((row) => row.breakout);
  const previousYearHigh = rows.find((row) => Number.isFinite(row.previousYearHigh))?.previousYearHigh;
  return {
    animation: false,
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    dataZoom: [{ end: 100, start: Math.max(0, 100 - (80 / Math.max(rows.length, 1)) * 100), type: "inside" }, { bottom: 4, height: 20, type: "slider" }],
    grid: [{ bottom: "28%", left: 50, right: 16, top: 24 }, { bottom: 36, height: "15%", left: 50, right: 16 }],
    legend: { data: ["日线", "BOLL上轨", "BOLL中轨", "BOLL下轨"], top: 0 },
    series: [
      {
        data: rows.map((row) => [row.open, row.close, row.low, row.high]),
        itemStyle: { color: "#b63a32", color0: "#16866a", borderColor: "#b63a32", borderColor0: "#16866a" },
        markLine: Number.isFinite(previousYearHigh) ? { data: [{ label: { formatter: "去年最高" }, yAxis: previousYearHigh }], symbol: "none" } : undefined,
        markPoint: breakout ? { data: [{ coord: [breakout.date, breakout.close], name: "首次突破", value: "突破" }] } : undefined,
        name: "日线",
        type: "candlestick",
      },
      { data: rows.map((row) => row.bollUpper), name: "BOLL上轨", showSymbol: false, type: "line" },
      { data: rows.map((row) => row.bollMiddle), name: "BOLL中轨", showSymbol: false, type: "line" },
      { data: rows.map((row) => row.bollLower), name: "BOLL下轨", showSymbol: false, type: "line" },
      { data: rows.map((row) => row.volume ?? 0), name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1 },
    ],
    tooltip: { axisPointer: { type: "cross" }, trigger: "axis" },
    xAxis: [
      { axisLine: { onZero: false }, data: dates, type: "category" },
      { axisLabel: { show: false }, data: dates, gridIndex: 1, type: "category" },
    ],
    yAxis: [{ scale: true }, { gridIndex: 1, scale: true }],
  };
}

export default function DailyChart({ rows = [] }) {
  const option = useMemo(() => buildDailyOption(rows), [rows]);
  const ref = useEChart(option);
  return <div aria-label="日线及 BOLL 图表" className="chart-canvas" ref={ref} role="img" />;
}
