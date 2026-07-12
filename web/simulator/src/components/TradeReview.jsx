export default function TradeReview({ candidates = [], fills = [], orders = [] }) {
  const tradedIds = new Set(orders.map((order) => order.candidateId));
  const untraded = candidates.filter((candidate) => !tradedIds.has(candidate.candidateId));
  return (
    <div className="trade-review">
      <h2>交易理由与候选证据</h2>
      {orders.length === 0 && <p className="empty-copy">本次练习没有提交订单。</p>}
      {orders.map((order) => {
        const fill = fills.find((item) => item.orderId === order.id);
        return <article className="review-order" key={order.id}><header><strong>{order.candidateSnapshot?.alias ?? "匿名候选"}</strong><span>{order.tradingDate} · {order.side === "buy" ? "买入" : "卖出"} {order.quantity} 股</span></header><blockquote>{order.reason}</blockquote><dl><div><dt>候选突破幅度</dt><dd>{Number.isFinite(order.candidateSnapshot?.evidence?.breakout_margin_pct) ? `${order.candidateSnapshot.evidence.breakout_margin_pct.toFixed(2)}%` : "—"}</dd></div><div><dt>订单状态</dt><dd>{order.status}</dd></div><div><dt>成交差异</dt><dd>{fill ? `成交价 ${fill.price} · 滑点 ${fill.slippageAmount}` : order.rejectionReason ?? "未成交"}</dd></div></dl></article>;
      })}
      {untraded.length > 0 && <p className="untraded-note">未交易候选：{untraded.map((candidate) => candidate.alias).join("、")}</p>}
    </div>
  );
}
