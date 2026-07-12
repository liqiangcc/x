import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DailyChart from "../charts/DailyChart.jsx";
import YearlyChart from "../charts/YearlyChart.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import MobileTradeBar from "../components/MobileTradeBar.jsx";
import OrderEditor from "../components/OrderEditor.jsx";
import PortfolioPanel from "../components/PortfolioPanel.jsx";
import { useSession } from "../state/SessionContext.jsx";

export default function TradePage() {
  const { busy, client, error, run, selectedCandidate, session, sessionId, setSession } = useSession();
  const candidate = selectedCandidate ?? session?.candidateSnapshot?.candidates?.[0] ?? null;
  const [chart, setChart] = useState(null);
  const [mobileTab, setMobileTab] = useState("daily");
  const [portfolio, setPortfolio] = useState(null);
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    if (!sessionId || !candidate) return;
    run(() => client.getChart(sessionId, candidate.candidateId)).then(setChart).catch(() => {});
  }, [candidate, client, run, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    run(() => client.getPortfolio(sessionId)).then(setPortfolio).catch(() => {});
  }, [client, run, sessionId]);

  if (!sessionId) return <section><h1>交易工作台</h1><p>请先创建会话并选择候选。</p><Link className="primary-link" to="/create">创建会话</Link></section>;
  if (!candidate) return <section><h1>交易工作台</h1><p>当前日期没有候选，请返回候选池调整配置。</p><Link className="primary-link" to="/candidates">返回候选池</Link></section>;
  const estimatedPrice = chart?.daily?.at(-1)?.close ?? candidate.evidence?.today_close ?? 0;

  async function submitOrder(input) {
    const response = await run(() => client.createOrder(sessionId, { ...input, expectedVersion: session.version }));
    setOrders([...orders, response.order]);
    setSession({ ...session, version: response.sessionVersion });
    setPortfolio(await client.getPortfolio(sessionId));
  }

  async function cancelOrder(order) {
    const response = await run(() => client.cancelOrder(sessionId, order.id, session.version));
    setOrders(orders.map((item) => item.id === order.id ? response.order : item));
    setSession({ ...session, version: response.sessionVersion });
    setPortfolio(await client.getPortfolio(sessionId));
  }

  async function reviseOrder(order) {
    const reason = window.prompt("修改交易理由", order.reason);
    if (!reason?.trim()) return;
    const response = await run(() => client.updateOrder(sessionId, order.id, { expectedVersion: session.version, reason: reason.trim() }));
    setOrders(orders.map((item) => item.id === order.id ? response.order : item));
    setSession({ ...session, version: response.sessionVersion });
  }

  async function complete() {
    const next = await run(() => client.completeDecision(sessionId, session.version));
    setSession(next);
  }

  async function advance() {
    const next = await run(() => client.advance(sessionId, session.version));
    setSession(next);
    setPortfolio(next.account);
    setOrders([]);
  }

  return (
    <section>
      <div className="page-heading-row"><div><p className="eyebrow">D 日决策 · D+1 开盘</p><h1>{candidate.alias}</h1></div><span className="data-badge">近似价格</span></div>
      <ErrorNotice error={error} />
      <div className="mobile-chart-tabs" role="tablist"><button aria-selected={mobileTab === "daily"} onClick={() => setMobileTab("daily")} role="tab">日线 + BOLL</button><button aria-selected={mobileTab === "yearly"} onClick={() => setMobileTab("yearly")} role="tab">年线</button></div>
      <div className="trade-workspace">
        <div className="trade-chart-grid">
          <div className={`panel chart-panel ${mobileTab === "daily" ? "mobile-active" : ""}`}><header><h2>日线 / BOLL / 成交量</h2><span>截至 {session.clock.currentDate}</span></header>{chart ? <DailyChart rows={chart.daily} /> : <div className="chart-loading">加载图表…</div>}</div>
          <div className={`panel chart-panel yearly-panel ${mobileTab === "yearly" ? "mobile-active" : ""}`}><header><h2>年线</h2><span>连续年度走势</span></header>{chart ? <YearlyChart rows={chart.yearly} /> : <div className="chart-loading">加载图表…</div>}</div>
        </div>
        <aside className="panel trade-side-panel">
          <PortfolioPanel portfolio={portfolio} />
          {session.status === "waiting_for_decision" && <OrderEditor candidate={candidate} disabled={busy} estimatedPrice={estimatedPrice} onSubmit={submitOrder} />}
          {orders.length > 0 && <div className="order-list"><h3>当日订单</h3>{orders.map((order) => <div className="order-row" key={order.id}><span>{order.side === "buy" ? "买" : "卖"} {order.quantity} 股 · {order.status}</span><small>{order.reason}</small>{order.status === "accepted" && <div><button className="text-button" onClick={() => reviseOrder(order)}>修改</button><button className="text-button danger-button" onClick={() => cancelOrder(order)}>取消</button></div>}</div>)}</div>}
          {session.status === "waiting_for_decision" ? <button className="primary-button desktop-action" disabled={busy} onClick={complete}>完成决策</button> : <button className="primary-button desktop-action" disabled={busy} onClick={advance}>推进到下一交易日</button>}
        </aside>
      </div>
      <MobileTradeBar busy={busy} onAdvance={advance} onComplete={complete} status={session.status} />
    </section>
  );
}
