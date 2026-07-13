function price(value) {
  return Number.isFinite(value) ? `¥${value.toFixed(2)}` : "—";
}

function signed(value, suffix = "") {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}` : "—";
}

export default function WatchlistSummary({ detail = {} }) {
  const signal = detail.signal;
  const holding = detail.holding;
  const metrics = [
    ["信号发生", signal ? `第 ${signal.dayIndex} 个交易日` : "—"],
    ["距今", signal ? `${signal.daysSince} 个交易日` : "—"],
    ["信号收盘", price(signal?.signalClose)],
    ["当前收盘", price(detail.currentClose)],
    ["信号涨跌", signed(signal?.changePct, "%"), signal?.changePct],
    ["持仓成本", price(holding?.averageCost)],
    ["此票收益率", signed(holding?.unrealizedPnlPct, "%"), holding?.unrealizedPnlPct],
    ["本轮买入", holding ? `${holding.buyCount} 次` : "0 次"],
    ["持有时间", Number.isFinite(holding?.holdingDays) ? `${holding.holdingDays} 个交易日` : "—"],
    ["BOLL 中轨", detail.boll?.aboveMiddle == null ? "数据不足" : detail.boll.aboveMiddle ? "已站上" : "未站上"],
  ];
  const rows = [metrics.slice(0, 5), metrics.slice(5)];
  return <div className="watchlist-summary">{rows.map((row, rowIndex) => <div className="watchlist-summary-line" key={rowIndex}>{row.map(([label, value, tone], index) => <span className="watchlist-value" key={label}>{index > 0 && <i aria-hidden="true">/</i>}<strong aria-label={`${label} ${value}`} className={Number.isFinite(tone) ? tone < 0 ? "loss-text" : "positive-text" : ""} title={`${label}：${value}`}>{value}</strong></span>)}</div>)}</div>;
}

export { price, signed };
