import { securityLabel, tradingDayLabel } from "../utils/securityDisplay.js";

function money(value) {
  return Number.isFinite(value) ? `¥${Number(value).toFixed(2)}` : "—";
}

export default function TradeReview({ anonymousMode = true, candidates = [], fills = [], orders = [] }) {
  const tradedIds = new Set(orders.map((order) => order.candidateId));
  const untraded = candidates.filter((candidate) => !tradedIds.has(candidate.candidateId));
  return (
    <div className="trade-review">
      <h2>交易理由与候选证据</h2>
      {orders.length === 0 && <p className="empty-copy">本次练习没有提交订单。</p>}
      {orders.map((order) => {
        const fill = fills.find((item) => item.orderId === order.id);
        return <article className="review-order" key={order.id}><header><strong>{securityLabel(order.candidateSnapshot, anonymousMode)}</strong><span>{order.side === "buy" ? "买入" : "卖出"} {order.quantity} 股 · {fill ? "已成交" : order.status}</span></header><small>{tradingDayLabel({ anonymousMode, date: order.tradingDate, dayIndex: order.dayIndex })}决策{fill ? ` · ${tradingDayLabel({ anonymousMode, date: fill.date, dayIndex: fill.dayIndex })}成交` : ""}</small><blockquote>{order.reason}</blockquote><dl><div><dt>参考价格</dt><dd>{money(order.estimatedPrice)}</dd></div><div><dt>实际成交</dt><dd>{fill ? `${money(fill.price)} / ${money(fill.grossAmount)}` : order.rejectionReason ?? "未成交"}</dd></div><div><dt>费用 / 滑点</dt><dd>{fill ? `${money(fill.fees?.total)} / ${money(fill.slippageAmount)}` : "—"}</dd></div><div><dt>候选突破</dt><dd>{Number.isFinite(order.candidateSnapshot?.evidence?.breakout_margin_pct) ? `${order.candidateSnapshot.evidence.breakout_margin_pct.toFixed(2)}%` : "—"}</dd></div></dl></article>;
      })}
      {untraded.length > 0 && <p className="untraded-note">未交易候选：{untraded.map((candidate) => securityLabel(candidate, anonymousMode)).join("、")}</p>}
    </div>
  );
}
