function percent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}

function money(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : "-"}¥${Math.abs(value).toFixed(2)}` : "—";
}

export default function StockCycleReview({ cycles = [] }) {
  return <section className="stock-cycle-review"><h2>每只股票收益</h2>
    {cycles.length === 0 && <p className="empty-copy">本次练习没有形成持仓周期。</p>}
    <div className="stock-cycle-grid">{cycles.map((cycle) => <article className="review-order" key={`${cycle.candidateId}-${cycle.cycleNumber}`}>
      <header><strong>{cycle.alias} · 第 {cycle.cycleNumber} 轮</strong><span>{cycle.status === "open" ? "持有中" : "已清仓"}</span></header>
      <dl>
        <div><dt>周期收益</dt><dd className={(cycle.totalPnl ?? 0) < 0 ? "loss-text" : "positive-text"}>{money(cycle.totalPnl)}</dd></div>
        <div><dt>周期收益率</dt><dd className={(cycle.returnPct ?? 0) < 0 ? "loss-text" : "positive-text"}>{percent(cycle.returnPct)}</dd></div>
        <div><dt>持有时间</dt><dd>{cycle.holdingDays ?? "—"} 个交易日</dd></div>
        <div><dt>买入次数</dt><dd>{cycle.buyCount} 次</dd></div>
        <div><dt>BOLL 中轨</dt><dd>{cycle.bollAboveMiddle == null ? "数据不足" : cycle.bollAboveMiddle ? "已站上" : "未站上"}</dd></div>
      </dl>
      <small>第 {cycle.startDayIndex ?? "—"} 个交易日开始 · {cycle.status === "open" ? `剩余 ${cycle.remainingQuantity} 股` : `第 ${cycle.endDayIndex ?? "—"} 个交易日结束`}</small>
    </article>)}</div>
  </section>;
}

export { money, percent };
