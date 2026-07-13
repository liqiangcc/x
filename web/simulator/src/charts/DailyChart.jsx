import { useMemo } from "react";
import useEChart from "./useEChart.js";

function dailyTooltip(rows, params = []) {
  const candle = params.find((item) => item.seriesName === "日线");
  const row = rows[candle?.dataIndex ?? params[0]?.dataIndex];
  if (!row) return "";
  const previous = rows[(candle?.dataIndex ?? params[0]?.dataIndex) - 1];
  const changePct = Number.isFinite(previous?.close) && previous.close !== 0
    ? ((row.close - previous.close) / previous.close) * 100
    : null;
  return [
    `<strong>${candle?.axisValue ?? ""}</strong>`,
    `开 ${row.open ?? "—"}　高 ${row.high ?? "—"}`,
    `低 ${row.low ?? "—"}　收 ${row.close ?? "—"}`,
    `涨跌 ${Number.isFinite(changePct) ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "—"}`,
    `量 ${Number.isFinite(row.volume) ? Number(row.volume).toLocaleString("zh-CN") : "—"}`,
  ].join("<br/>");
}

export function buildDailyOption(rows = [], { showBoll = true, showVolume = true } = {}) {
  const dates = rows.map((_row, index) => index === rows.length - 1 ? "D0" : `D-${rows.length - 1 - index}`);
  const breakout = rows.find((row) => row.signal || row.breakout);
  const previousYearHigh = rows.find((row) => Number.isFinite(row.previousYearHigh))?.previousYearHigh;
  return {
    animation: false,
    axisPointer: { label: { backgroundColor: "#3f4945" }, link: [{ xAxisIndex: "all" }], snap: true },
    backgroundColor: "#fffdf8",
    dataZoom: [{ end: 100, start: 0, type: "inside" }, { bottom: 2, borderColor: "transparent", end: 100, fillerColor: "rgba(11,107,80,.12)", height: 18, start: 0, type: "slider" }],
    grid: [
      { bottom: showVolume ? "29%" : 42, left: 48, right: 12, top: 18 },
      { bottom: 32, height: showVolume ? "16%" : 0, left: 48, right: 12 },
    ],
    series: [
      {
        data: rows.map((row) => [row.open, row.close, row.low, row.high]),
        itemStyle: { color: "#b63a32", color0: "#16866a", borderColor: "#b63a32", borderColor0: "#16866a" },
        markLine: Number.isFinite(previousYearHigh) ? { data: [{ label: { formatter: "去年最高" }, yAxis: previousYearHigh }], symbol: "none" } : undefined,
        markPoint: breakout ? { data: [{ coord: [dates[rows.indexOf(breakout)], breakout.close], name: breakout.signal ? "信号日" : "首次突破", value: breakout.signal ? "信号" : "突破" }] } : undefined,
        name: "日线",
        type: "candlestick",
      },
      { data: showBoll ? rows.map((row) => row.bollUpper) : [], lineStyle: { color: "#b88a2f", width: 1 }, name: "BOLL上轨", showSymbol: false, type: "line" },
      { data: showBoll ? rows.map((row) => row.bollMiddle) : [], lineStyle: { color: "#396aaf", width: 1.2 }, name: "BOLL中轨", showSymbol: false, type: "line" },
      { data: showBoll ? rows.map((row) => row.bollLower) : [], lineStyle: { color: "#8b5aa3", width: 1 }, name: "BOLL下轨", showSymbol: false, type: "line" },
      { data: showVolume ? rows.map((row) => ({ itemStyle: { color: row.close >= row.open ? "#b63a32" : "#16866a" }, value: row.volume ?? 0 })) : [], name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1 },
    ],
    tooltip: { axisPointer: { type: "cross" }, backgroundColor: "rgba(22,37,31,.92)", borderWidth: 0, confine: true, formatter: (params) => dailyTooltip(rows, params), textStyle: { color: "#fff", fontSize: 11 }, trigger: "axis" },
    xAxis: [
      { axisLine: { lineStyle: { color: "#aeb7b1" }, onZero: false }, axisTick: { show: false }, data: dates, splitLine: { show: false }, type: "category" },
      { axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, data: dates, gridIndex: 1, type: "category" },
    ],
    yAxis: [
      { axisLabel: { fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, scale: true, splitLine: { lineStyle: { color: "#e8ebe6", type: "dashed" } } },
      { axisLabel: { fontSize: 9 }, axisLine: { show: false }, axisTick: { show: false }, gridIndex: 1, scale: true, splitLine: { show: false } },
    ],
  };
}

export default function DailyChart({ rows = [], showBoll = true, showVolume = true }) {
  const option = useMemo(() => buildDailyOption(rows, { showBoll, showVolume }), [rows, showBoll, showVolume]);
  const ref = useEChart(option);
  return <div aria-label="日线及 BOLL 图表" className="chart-canvas" ref={ref} role="img" />;
}
