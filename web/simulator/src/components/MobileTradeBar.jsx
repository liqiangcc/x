export default function MobileTradeBar({ busy, onAdvance, onComplete, status }) {
  return (
    <div className="mobile-trade-bar">
      {status === "waiting_for_decision" ? <><a className="secondary-button" href="#order-editor">买卖</a><button className="primary-button" disabled={busy} onClick={onComplete}>完成决策</button></> : <button className="primary-button full-button" disabled={busy} onClick={onAdvance}>推进到下一交易日</button>}
    </div>
  );
}
