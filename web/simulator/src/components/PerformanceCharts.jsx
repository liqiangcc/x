function points(values, width, height) {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * width},${height - ((value - min) / range) * height}`).join(" ");
}

export default function PerformanceCharts({ benchmark, equityCurve = [] }) {
  const equities = equityCurve.map((item) => item.equity);
  let peak = -Infinity;
  const drawdowns = equities.map((equity) => {
    peak = Math.max(peak, equity);
    return peak > 0 ? (peak - equity) / peak : 0;
  });
  return (
    <div className="performance-charts">
      <figure><figcaption>账户权益</figcaption>{equities.length > 1 ? <svg aria-label="账户权益曲线" role="img" viewBox="0 0 600 180"><polyline fill="none" points={points(equities, 600, 180)} stroke="#0b6b50" strokeWidth="4" /></svg> : <div className="chart-empty">会话较短，暂无曲线</div>}</figure>
      <figure><figcaption>回撤</figcaption>{drawdowns.length > 1 ? <svg aria-label="回撤曲线" role="img" viewBox="0 0 600 180"><polyline fill="none" points={points(drawdowns, 600, 180)} stroke="#a33a2b" strokeWidth="4" /></svg> : <div className="chart-empty">暂无回撤</div>}</figure>
      <p className="benchmark-note">{benchmark?.status === "available" ? `沪深300同期收益 ${(benchmark.totalReturn * 100).toFixed(2)}%` : "沪深300基准暂无本地数据（TODO）"}</p>
    </div>
  );
}

export { points };
