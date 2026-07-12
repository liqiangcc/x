import { useState } from "react";
import { money } from "./PortfolioPanel.jsx";

function estimate(price, quantity, side) {
  const gross = Number(price || 0) * Number(quantity || 0);
  const commission = Math.max(gross * 0.0003, 5);
  const stamp = side === "sell" ? gross * 0.0005 : 0;
  return { fees: commission + stamp, gross, reserved: side === "buy" ? gross + commission : quantity };
}

export default function OrderEditor({ candidate, disabled, estimatedPrice, onSubmit }) {
  const [form, setForm] = useState({ quantity: 100, reason: "", side: "buy" });
  const [confirming, setConfirming] = useState(false);
  const amounts = estimate(estimatedPrice, form.quantity, form.side);

  function prepare(event) {
    event.preventDefault();
    if (!form.reason.trim()) return;
    setConfirming(true);
  }

  async function confirm() {
    await onSubmit({
      candidateId: candidate.candidateId,
      estimatedFees: amounts.fees,
      estimatedPrice,
      quantity: Number(form.quantity),
      reason: form.reason.trim(),
      side: form.side,
    });
    setConfirming(false);
    setForm({ ...form, reason: "" });
  }

  return (
    <form className="order-editor" id="order-editor" onSubmit={prepare}>
      <h3>提交下一开盘订单</h3>
      <div className="order-fields"><label>方向<select disabled={disabled} value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value })}><option value="buy">买入</option><option value="sell">卖出</option></select></label><label>数量（股）<input disabled={disabled} min="1" required type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label></div>
      <label>交易理由<textarea disabled={disabled} placeholder="记录当时判断，复盘时会保留" required rows="3" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
      {!confirming ? <button className="primary-button" disabled={disabled || !form.reason.trim()} type="submit">预览订单</button> : (
        <div className="order-confirm" role="dialog" aria-label="确认订单"><strong>{form.side === "buy" ? "买入" : "卖出"} {candidate.alias} · {form.quantity} 股</strong><span>预计金额 ¥{money(amounts.gross)}</span><span>预计费用 ¥{money(amounts.fees)}</span><span>{form.side === "buy" ? `冻结资金 ¥${money(amounts.reserved)}` : `冻结股份 ${form.quantity} 股`}</span><div><button className="text-button" onClick={() => setConfirming(false)} type="button">返回修改</button><button className="primary-button" disabled={disabled} onClick={confirm} type="button">确认提交</button></div></div>
      )}
    </form>
  );
}

export { estimate };
