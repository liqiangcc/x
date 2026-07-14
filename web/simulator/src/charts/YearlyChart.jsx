import { useEffect, useMemo, useState } from "react";
import useEChart from "./useEChart.js";

export function buildYearlyOption(rows = [], { anonymousMode = true, windowEnd = rows.length - 1, windowStart = 0 } = {}) {
  const labels = rows.map((row) => anonymousMode ? "" : String(row.year));
  return {
    animation: false,
    axisPointer: { snap: true },
    backgroundColor: "#fffdf8",
    dataZoom: [{ endValue: windowEnd, startValue: windowStart, type: "inside" }],
    grid: { bottom: 32, left: 48, right: 12, top: 18 },
    series: [{
      data: rows.map((row) => [row.open, row.close, row.low, row.high]),
      itemStyle: { color: "#b63a32", color0: "#16866a", borderColor: "#b63a32", borderColor0: "#16866a" },
      name: "年线",
      type: "candlestick",
    }],
    tooltip: { axisPointer: { type: "cross" }, backgroundColor: "rgba(22,37,31,.92)", borderWidth: 0, confine: true, textStyle: { color: "#fff", fontSize: 11 }, trigger: "axis" },
    xAxis: { axisLabel: { show: !anonymousMode }, axisLine: { lineStyle: { color: "#aeb7b1" } }, axisTick: { show: false }, data: labels, type: "category" },
    yAxis: { axisLabel: { fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, scale: true, splitLine: { lineStyle: { color: "#e8ebe6", type: "dashed" } } },
  };
}

export default function YearlyChart({ anonymousMode = true, rows = [] }) {
  const windowSize = 10;
  const maxStart = Math.max(0, rows.length - windowSize);
  const [windowStart, setWindowStart] = useState(maxStart);
  useEffect(() => setWindowStart(maxStart), [maxStart, rows]);
  const windowEnd = Math.min(rows.length - 1, windowStart + windowSize - 1);
  const ref = useEChart(useMemo(() => buildYearlyOption(rows, { anonymousMode, windowEnd, windowStart }), [anonymousMode, rows, windowEnd, windowStart]));
  return <div className="kline-navigator"><div aria-label="年线图表" className="chart-canvas yearly-canvas" ref={ref} role="img" /><div className="kline-move-buttons"><button aria-label="向左查看更早年K" disabled={windowStart === 0} onClick={() => setWindowStart((value) => Math.max(0, value - 1))} type="button">←</button><span>{rows.length === 0 ? "0/0" : `${windowStart + 1}-${windowEnd + 1}/${rows.length}`}</span><button aria-label="向右查看更新年K" disabled={windowStart >= maxStart} onClick={() => setWindowStart((value) => Math.min(maxStart, value + 1))} type="button">→</button></div></div>;
}
