import { useMemo } from "react";
import useEChart from "./useEChart.js";

export function buildYearlyOption(rows = []) {
  return {
    animation: false,
    dataZoom: [{ type: "inside" }],
    grid: { bottom: 30, left: 50, right: 16, top: 24 },
    series: [{
      data: rows.map((row) => [row.open, row.close, row.low, row.high]),
      itemStyle: { color: "#b63a32", color0: "#16866a", borderColor: "#b63a32", borderColor0: "#16866a" },
      name: "年线",
      type: "candlestick",
    }],
    tooltip: { axisPointer: { type: "cross" }, trigger: "axis" },
    xAxis: { data: rows.map((row) => String(row.year)), type: "category" },
    yAxis: { scale: true },
  };
}

export default function YearlyChart({ rows = [] }) {
  const ref = useEChart(useMemo(() => buildYearlyOption(rows), [rows]));
  return <div aria-label="年线图表" className="chart-canvas yearly-canvas" ref={ref} role="img" />;
}
