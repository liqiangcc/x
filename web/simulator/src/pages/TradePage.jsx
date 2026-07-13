import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DailyChart from "../charts/DailyChart.jsx";
import YearlyChart from "../charts/YearlyChart.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import OrderEditor from "../components/OrderEditor.jsx";
import PortfolioPanel from "../components/PortfolioPanel.jsx";
import WatchlistSummary from "../components/WatchlistSummary.jsx";
import { useSession } from "../state/SessionContext.jsx";

const chartCache = new Map();
const chartRequests = new Map();

function cachedChart(client, accountId, candidateId, dayIndex) {
  const key = `${accountId}:${candidateId}:${dayIndex}`;
  if (chartCache.has(key)) return Promise.resolve(chartCache.get(key));
  if (!chartRequests.has(key)) {
    chartRequests.set(key, client.getStockChart(accountId, candidateId).then((result) => {
      chartCache.set(key, result);
      chartRequests.delete(key);
      return result;
    }).catch((error) => {
      chartRequests.delete(key);
      throw error;
    }));
  }
  return chartRequests.get(key);
}

export { cachedChart };

export function mergePortfolioSnapshot(current, account) {
  if (!account) return current;
  if (!current) return account;
  const currentPositions = new Map((current.positions ?? []).map((position) => [position.candidateId, position]));
  return {
    ...current,
    cash: account.cash,
    cashAvailable: account.cashAvailable,
    frozenCash: account.frozenCash,
    positions: (account.positions ?? []).map((position) => ({
      ...currentPositions.get(position.candidateId),
      ...position,
    })),
    realizedPnl: account.realizedPnl,
    totalFees: account.totalFees,
  };
}

export default function TradePage() {
  const { accountId: routeAccountId, candidateId: routeCandidateId } = useParams();
  const { busy, client, error, run, selectedCandidate, session, setError, setSession, settings } = useSession();
  const accountReady = session?.id === routeAccountId;
  const sessionId = accountReady ? routeAccountId : null;
  const currentCandidates = session?.candidateSnapshot?.candidates ?? [];
  const candidate = currentCandidates.find((item) => item.candidateId === routeCandidateId)
    ?? (selectedCandidate?.candidateId === routeCandidateId ? selectedCandidate : null)
    ?? (routeCandidateId ? { alias: "自选股票", candidateId: routeCandidateId, evidence: {} } : null);
  const [chart, setChart] = useState(null);
  const [mobileTab, setMobileTab] = useState("daily");
  const [showBoll, setShowBoll] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [portfolio, setPortfolio] = useState(null);
  const [orders, setOrders] = useState([]);
  const [fills, setFills] = useState([]);
  const [sellTarget, setSellTarget] = useState(null);

  useEffect(() => {
    if (!routeAccountId || accountReady) return;
    let active = true;
    client.getAccount(routeAccountId)
      .then((account) => { if (active) setSession(account); })
      .catch((caught) => { if (active) setError(caught); });
    return () => { active = false; };
  }, [accountReady, client, routeAccountId, setError, setSession]);

  useEffect(() => {
    const candidateId = candidate?.candidateId;
    if (!sessionId || !candidateId) {
      setChart(null);
      return;
    }
    let active = true;
    setChart(null);
    cachedChart(client, sessionId, candidateId, session?.dayIndex ?? 1)
      .then((result) => { if (active) setChart(result); })
      .catch((caught) => { if (active) setError(caught); });
    return () => { active = false; };
  }, [candidate?.candidateId, client, session?.dayIndex, sessionId, setError]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    client.getPortfolio(sessionId).then((result) => { if (active) setPortfolio(result); }).catch((caught) => { if (active) setError(caught); });
    return () => { active = false; };
  }, [client, session?.dayIndex, sessionId, setError]);

  useEffect(() => {
    if (!sessionId || !session?.clock?.currentDate) return;
    Promise.all([
      client.getOrders(sessionId),
      client.getFills(sessionId),
    ]).then(([orderResult, fillResult]) => {
      setOrders(orderResult.orders ?? []);
      setFills(fillResult.fills ?? []);
    }).catch(setError);
  }, [client, session?.clock?.currentDate, sessionId, setError]);

  if (!routeAccountId) return <section><h1>交易工作台</h1><p>请先创建账号并选择候选。</p><Link className="primary-link" to="/accounts/new">创建账号</Link></section>;
  if (!accountReady) return <section><h1>股票详情</h1><div className="chart-loading">正在加载对应账号…</div><ErrorNotice error={error} /></section>;
  const estimatedPrice = chart?.daily?.at(-1)?.close ?? candidate?.evidence?.today_close ?? 0;
  const signal = chart?.detail?.signal;
  const latestBar = chart?.daily?.at(-1);
  const previousBar = chart?.daily?.at(-2);
  const priceChange = Number.isFinite(latestBar?.close) && Number.isFinite(previousBar?.close)
    ? latestBar.close - previousBar.close
    : null;
  const priceChangePct = Number.isFinite(priceChange) && previousBar.close !== 0
    ? (priceChange / previousBar.close) * 100
    : null;
  const rising = (priceChange ?? 0) >= 0;
  const stockOrders = orders.filter((order) => order.candidateId === candidate?.candidateId);
  const stockOrderIds = new Set(stockOrders.map((order) => order.id));
  const stockFills = fills.filter((fill) => stockOrderIds.has(fill.orderId));
  const recentOrders = stockOrders.slice(-5).reverse();
  const recentFills = stockFills.slice(-5).reverse();

  async function submitOrder(input) {
    const response = await run(() => client.createOrder(sessionId, { ...input, expectedVersion: session.version }));
    setOrders((current) => [...current.filter((item) => item.id !== response.order.id), response.order]);
    setSession({ ...session, version: response.sessionVersion });
    setPortfolio((current) => mergePortfolioSnapshot(current, response.account));
    setSellTarget(null);
    if (response.order.status === "rejected") {
      const rejection = new Error("订单未被接受");
      rejection.code = response.order.rejectionReason;
      setError(rejection);
    }
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

  return (
    <section className="stock-detail-page">
      <div className="stock-quote-header">
        <div className="stock-quote-identity"><p className="eyebrow">D 日决策 · D+1 开盘</p><h1>{chart?.alias ?? candidate?.alias ?? "当日无候选"}</h1><span className="data-badge">近似价格</span></div>
        <div className={rising ? "stock-last-price rising-price" : "stock-last-price falling-price"}><strong>{Number.isFinite(latestBar?.close) ? latestBar.close.toFixed(2) : "—"}</strong><span>{Number.isFinite(priceChange) ? `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}` : "—"} / {Number.isFinite(priceChangePct) ? `${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(2)}%` : "—"}</span></div>
        <dl className="stock-ohlc"><div><dt>今开</dt><dd>{latestBar?.open ?? "—"}</dd></div><div><dt>最高</dt><dd>{latestBar?.high ?? "—"}</dd></div><div><dt>最低</dt><dd>{latestBar?.low ?? "—"}</dd></div><div><dt>成交量</dt><dd>{Number.isFinite(latestBar?.volume) ? Number(latestBar.volume).toLocaleString("zh-CN") : "—"}</dd></div></dl>
      </div>
      <ErrorNotice error={error} />
      {chart?.detail && <div className="panel signal-performance">
        <WatchlistSummary detail={chart.detail} />
        {(signal?.source === "inferred" || (chart.detail.currentPriceDayOffset ?? 0) > 0) && <small>{signal?.source === "inferred" ? "历史信号推定" : ""}{signal?.source === "inferred" && (chart.detail.currentPriceDayOffset ?? 0) > 0 ? " / " : ""}{(chart.detail.currentPriceDayOffset ?? 0) > 0 ? "最近可用收盘" : ""}</small>}
      </div>}
      <div className="mobile-chart-tabs market-chart-toolbar"><div role="tablist"><button aria-selected={mobileTab === "daily"} onClick={() => setMobileTab("daily")} role="tab">日K</button><button aria-selected={mobileTab === "yearly"} onClick={() => setMobileTab("yearly")} role="tab">年K</button></div><div className="indicator-switches"><button aria-pressed={showBoll} disabled={mobileTab !== "daily"} onClick={() => setShowBoll((value) => !value)} type="button">BOLL</button><button aria-pressed={showVolume} disabled={mobileTab !== "daily"} onClick={() => setShowVolume((value) => !value)} type="button">成交量</button></div></div>
      <div className="trade-workspace">
        <div className="trade-chart-grid">
          <div className="panel chart-panel mobile-active"><header><h2>{mobileTab === "daily" ? "日K走势" : "年K走势"}</h2><span>拖动缩放 · 长按查看开高低收</span></header>{chart ? mobileTab === "daily" ? <DailyChart rows={chart.daily} showBoll={showBoll} showVolume={showVolume} /> : <YearlyChart rows={chart.yearly} /> : <div className="chart-loading">{candidate ? "加载图表…" : "当日没有买入候选，仍可管理已有持仓。"}</div>}</div>
        </div>
        <aside className="panel trade-side-panel">
          <PortfolioPanel onSell={session.status === "waiting_for_decision" ? setSellTarget : null} portfolio={portfolio} />
          {session.status === "waiting_for_decision" && (sellTarget || (candidate && chart?.detail?.canBuy)) && <OrderEditor candidate={sellTarget ?? candidate} disabled={busy} estimatedPrice={sellTarget?.averageCost ?? estimatedPrice} initialAmount={settings.defaultBuyAmount} initialQuantity={sellTarget?.availableQuantity ?? 100} initialReason={settings.defaultBuyReason} initialSide={sellTarget ? "sell" : "buy"} maxQuantity={sellTarget?.availableQuantity} onSubmit={submitOrder} />}
          {session.status === "waiting_for_decision" && candidate && chart?.detail && !chart.detail.canBuy && <p className="quality-note">该股票既不是当前候选，也不在自选中，当前只能查看走势。</p>}
          {recentOrders.length > 0 && <div className="order-list"><h3>本票订单 <small>最近 {recentOrders.length}/{stockOrders.length}</small></h3>{recentOrders.map((order) => <div className="order-row" key={order.id}><span>{order.side === "buy" ? "买" : "卖"} {order.quantity} 股 · {order.status}</span><small>{order.reason}</small>{order.rejectionReason && <small className="danger-text">{order.rejectionReason}</small>}{order.status === "accepted" && order.tradingDate === session.clock.currentDate && <div><button className="text-button" onClick={() => reviseOrder(order)}>修改</button><button className="text-button danger-button" onClick={() => cancelOrder(order)}>取消</button></div>}</div>)}</div>}
          {recentFills.length > 0 && <div className="order-list"><h3>本票成交 <small>最近 {recentFills.length}/{stockFills.length}</small></h3>{recentFills.map((fill) => <div className="order-row" key={fill.id}><span>{fill.side === "buy" ? "买入" : "卖出"} {fill.quantity} 股 · ¥{fill.price}</span><small>费用 ¥{fill.fees.total}</small></div>)}</div>}
          <p className="quality-note">订单将在顶部“下一交易日”推进时按次日开盘统一执行。</p>
        </aside>
      </div>
    </section>
  );
}
