import { useMemo } from "react";
import useEChart from "./useEChart.js";

export function buildYearlyOption(rows = []) {
  const labels = rows.map((_row, index) => index === rows.length - 1 ? "本年" : `Y-${rows.length - 1 - index}`);
  return {
    animation: false,
    axisPointer: { snap: true },
    backgroundColor: "#fffdf8",
    dataZoom: [{ type: "inside" }],
    grid: { bottom: 32, left: 48, right: 12, top: 18 },
    series: [{
      data: rows.map((row) => [row.open, row.close, row.low, row.high]),
      itemStyle: { color: "#b63a32", color0: "#16866a", borderColor: "#b63a32", borderColor0: "#16866a" },
      name: "年线",
      type: "candlestick",
    }],
    tooltip: { axisPointer: { type: "cross" }, backgroundColor: "rgba(22,37,31,.92)", borderWidth: 0, confine: true, textStyle: { color: "#fff", fontSize: 11 }, trigger: "axis" },
    xAxis: { axisLine: { lineStyle: { color: "#aeb7b1" } }, axisTick: { show: false }, data: labels, type: "category" },
    yAxis: { axisLabel: { fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, scale: true, splitLine: { lineStyle: { color: "#e8ebe6", type: "dashed" } } },
  };
}

export default function YearlyChart({ rows = [] }) {
  const ref = useEChart(useMemo(() => buildYearlyOption(rows), [rows]));
  return <div aria-label="年线图表" className="chart-canvas yearly-canvas" ref={ref} role="img" />;
}
