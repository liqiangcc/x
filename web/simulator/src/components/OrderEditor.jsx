import { useEffect, useRef, useState } from "react";
import { money } from "./PortfolioPanel.jsx";

function estimate(price, quantity, side) {
  const gross = Number(price || 0) * Number(quantity || 0);
  const commission = Math.max(gross * 0.0003, 5);
  const stamp = side === "sell" ? gross * 0.0005 : 0;
  return { fees: commission + stamp, gross, reserved: side === "buy" ? gross + commission : quantity };
}

function quantityForAmount(amount, price) {
  if (!Number.isFinite(Number(amount)) || !Number.isFinite(Number(price)) || Number(price) <= 0) return 0;
  return Math.floor(Number(amount) / Number(price) / 100) * 100;
}

function initialForm({ estimatedPrice, initialAmount, initialQuantity, initialReason, initialSide }) {
  const amount = initialAmount ?? 10000;
  return {
    amount,
    quantity: initialSide === "buy" ? quantityForAmount(amount, estimatedPrice) : initialQuantity,
    reason: initialSide === "buy" ? initialReason : "",
    side: initialSide,
  };
}

export default function OrderEditor({ candidate, disabled, estimatedPrice, initialAmount = 10000, initialQuantity = 100, initialReason = "", initialSide = "buy", maxQuantity, onSubmit }) {
  const [form, setForm] = useState(() => initialForm({ estimatedPrice, initialAmount, initialQuantity, initialReason, initialSide }));
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const amounts = estimate(estimatedPrice, form.quantity, form.side);

  useEffect(() => {
    setForm(initialForm({ estimatedPrice, initialAmount, initialQuantity, initialReason, initialSide }));
    setConfirming(false);
  }, [candidate.candidateId, initialAmount, initialQuantity, initialReason, initialSide]);

  function prepare(event) {
    event.preventDefault();
    if (!form.reason.trim()) return;
    setConfirming(true);
  }

  async function confirm() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
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
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="order-editor" id="order-editor" onSubmit={prepare}>
      <h3>提交下一开盘订单</h3>
      <div className="order-fields"><label>方向<select disabled={disabled || initialSide === "sell"} value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value })}><option value="buy">买入</option><option value="sell">卖出</option></select></label>{form.side === "buy" && <label>买入金额（元）<input disabled={disabled} min="0" required step="100" type="number" value={form.amount} onChange={(event) => { const amount = event.target.value; setForm({ ...form, amount, quantity: quantityForAmount(amount, estimatedPrice) }); }} /></label>}<label>数量（股）<input disabled={disabled} max={maxQuantity} min="1" required type="number" value={form.quantity} onChange={(event) => { const quantity = event.target.value; setForm({ ...form, amount: form.side === "buy" ? Number(quantity || 0) * Number(estimatedPrice || 0) : form.amount, quantity }); }} /></label></div>
      {form.side === "buy" && form.quantity < 100 && <p className="field-error">金额不足买入一手（100 股），请提高金额。</p>}
      <label>交易理由<textarea disabled={disabled} placeholder="记录当时判断，复盘时会保留" required rows="3" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
      {!confirming ? <button className="primary-button" disabled={disabled || !form.reason.trim() || Number(form.quantity) < 1} type="submit">预览订单</button> : (
        <div className="order-confirm" role="dialog" aria-label="确认订单"><strong>{form.side === "buy" ? "买入" : "卖出"} {candidate.alias} · {form.quantity} 股</strong><span>参考金额 ¥{money(amounts.gross)}</span><span>预计费用 ¥{money(amounts.fees)}</span><span>{form.side === "buy" ? "冻结资金由服务端按适用涨停价计算，成交后退回差额" : `冻结股份 ${form.quantity} 股`}</span><div><button className="text-button" disabled={submitting} onClick={() => setConfirming(false)} type="button">返回修改</button><button className="primary-button" disabled={disabled || submitting} onClick={confirm} type="button">{submitting ? "提交中…" : "确认提交"}</button></div></div>
      )}
    </form>
  );
}

export { estimate, quantityForAmount };
