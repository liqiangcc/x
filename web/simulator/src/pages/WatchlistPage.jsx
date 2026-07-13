import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ErrorNotice from "../components/ErrorNotice.jsx";
import OrderEditor from "../components/OrderEditor.jsx";
import WatchlistSummary from "../components/WatchlistSummary.jsx";
import { useSession } from "../state/SessionContext.jsx";

export default function WatchlistPage() {
  const { busy, client, error, run, session, sessionId, setError, setSession, settings } = useSession();
  const [items, setItems] = useState([]);
  const [bollFilter, setBollFilter] = useState("crossed");
  const [profitFilter, setProfitFilter] = useState("all");
  const [actionTarget, setActionTarget] = useState(null);
  const [tradeTarget, setTradeTarget] = useState(null);
  const promptSellAfterReload = useRef(false);
  const skipNextReload = useRef(false);
  const advancing = useRef(false);
  function applyItems(nextItems, promptSell = false) {
    setItems(nextItems);
    if (!promptSell) return;
    const target = nextItems.find((item) => {
      const holding = item.detail?.holding;
      return holding?.availableQuantity > 0 && Number.isFinite(holding.unrealizedPnlPct)
        && holding.unrealizedPnlPct >= settings.defaultSellReturnPct;
    });
    if (target) setTradeTarget({ item: target, sellPrompt: true, side: "sell" });
  }
  function reload() {
    return run(() => client.getWatchlist(sessionId)).then((result) => {
      const promptSell = promptSellAfterReload.current;
      promptSellAfterReload.current = false;
      applyItems(result.items, promptSell);
      return result;
    });
  }
  useEffect(() => {
    if (!sessionId) return;
    if (skipNextReload.current) {
      skipNextReload.current = false;
      return;
    }
    reload().catch(() => {});
  }, [session?.clock?.currentDate, sessionId]);
  if (!sessionId) return <section><h1>自选</h1><Link to="/accounts/new">请先新建账号</Link></section>;
  const visibleItems = items.filter((item) => {
    const returnPct = item.detail?.holding?.unrealizedPnlPct;
    const aboveMiddle = item.detail?.boll?.aboveMiddle;
    const justCrossedMiddle = item.detail?.boll?.justCrossedMiddle;
    const profitMatches = profitFilter === "all"
      || (profitFilter === "profit" ? Number.isFinite(returnPct) && returnPct > 0 : Number.isFinite(returnPct) && returnPct <= 0);
    const bollMatches = bollFilter === "all"
      || (bollFilter === "crossed" ? justCrossedMiddle === true : bollFilter === "above" ? aboveMiddle === true : aboveMiddle === false);
    return profitMatches && bollMatches;
  });
  async function submitOrder(input) {
    const response = await run(() => client.createOrder(sessionId, { ...input, expectedVersion: session.version }));
    setSession({ ...session, version: response.sessionVersion });
    if (response.order.status === "rejected") {
      const rejection = new Error("订单未被接受");
      rejection.code = response.order.rejectionReason;
      setError(rejection);
      throw rejection;
    }
    const position = response.account?.positions?.find((item) => item.candidateId === input.candidateId);
    if (position) {
      setItems((current) => current.map((item) => item.candidateId === input.candidateId
        ? { ...item, detail: { ...item.detail, holding: { ...item.detail?.holding, ...position } } }
        : item));
    }
    setTradeTarget(null);
  }
  async function advance() {
    if (advancing.current) return;
    advancing.current = true;
    skipNextReload.current = true;
    try {
      const next = await run(() => client.advanceAccount(session.id, session.version));
      if (Array.isArray(next.watchlistItems)) {
        applyItems(next.watchlistItems, true);
      } else {
        skipNextReload.current = false;
        promptSellAfterReload.current = true;
      }
      setSession(next);
    } catch (error) {
      skipNextReload.current = false;
      throw error;
    } finally {
      advancing.current = false;
    }
  }
  return <section><p className="eyebrow">跨日期保留 · 匿名观察</p><div className="watchlist-heading"><h1>我的自选</h1><div className="watchlist-clock"><strong>{session.name}</strong><span>第 {session.dayIndex ?? 1} 个交易日</span><button className="primary-button" disabled={busy || !session.clock.nextDate} onClick={advance}>{busy ? "推进中…" : "下一交易日"}</button></div></div><ErrorNotice error={error} />
    <div className="watchlist-filters"><label>是否盈利<select aria-label="是否盈利" value={profitFilter} onChange={(event) => setProfitFilter(event.target.value)}><option value="all">全部</option><option value="profit">盈利</option><option value="loss">未盈利</option></select></label><label>BOLL中轨<select aria-label="BOLL中轨" value={bollFilter} onChange={(event) => setBollFilter(event.target.value)}><option value="crossed">刚站上</option><option value="all">全部</option><option value="above">站上</option><option value="below">未站上</option></select></label><span>{visibleItems.length}/{items.length}</span></div>
    <div className="watchlist-list">{visibleItems.map((item) => <article className="watchlist-row" key={item.candidateId}><div className="watchlist-identity"><h2>{item.alias}</h2>{item.signal?.source === "inferred" && <span>推定</span>}</div><button aria-label={`操作${item.alias}`} className="secondary-button compact-button watchlist-menu-button" onClick={() => setActionTarget(item)} type="button">操作</button><WatchlistSummary detail={item.detail} /></article>)}</div>
    {items.length === 0 && <div className="empty-state"><strong>自选为空</strong><span>从当日候选池添加股票。</span></div>}
    {items.length > 0 && visibleItems.length === 0 && <div className="empty-state compact-empty"><strong>没有符合筛选条件的自选股</strong></div>}
    {actionTarget && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setActionTarget(null); }}><div aria-label={`${actionTarget.alias}操作`} className="panel action-modal" role="dialog"><div className="modal-heading"><strong>{actionTarget.alias}</strong><button className="text-button" onClick={() => setActionTarget(null)} type="button">关闭</button></div><div className="action-modal-buttons"><Link className="secondary-button" onClick={() => setActionTarget(null)} to={`/accounts/${sessionId}/stocks/${actionTarget.candidateId}`}>查看走势</Link><button className="primary-button" disabled={busy || session.status !== "waiting_for_decision"} onClick={() => { setTradeTarget({ item: actionTarget, side: "buy" }); setActionTarget(null); }} type="button">买入</button>{actionTarget.detail?.holding && <button className="secondary-button" disabled={busy || session.status !== "waiting_for_decision" || actionTarget.detail.holding.availableQuantity < 1} onClick={() => { setTradeTarget({ item: actionTarget, side: "sell" }); setActionTarget(null); }} type="button">卖出</button>}<button className="text-button danger-button" onClick={async () => { const item = actionTarget; setActionTarget(null); await run(() => client.removeWatchlist(sessionId, item.candidateId)); await reload(); }} type="button">移除自选</button></div></div></div>}
    {tradeTarget && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTradeTarget(null); }}><div aria-label={`${tradeTarget.item.alias}${tradeTarget.side === "buy" ? "买入" : "卖出"}`} className="panel trade-modal" role="dialog"><div className="modal-heading"><strong>{tradeTarget.item.alias} · {tradeTarget.side === "buy" ? "买入" : "卖出"}{tradeTarget.sellPrompt ? `（收益率 ${tradeTarget.item.detail.holding.unrealizedPnlPct >= 0 ? "+" : ""}${tradeTarget.item.detail.holding.unrealizedPnlPct.toFixed(2)}%，达到止盈提示）` : ""}</strong><button className="text-button" onClick={() => setTradeTarget(null)} type="button">关闭</button></div><OrderEditor candidate={tradeTarget.item} disabled={busy} estimatedPrice={tradeTarget.item.detail.currentClose ?? tradeTarget.item.detail.holding?.averageCost ?? 0} initialAmount={settings.defaultBuyAmount} initialQuantity={tradeTarget.side === "sell" ? tradeTarget.item.detail.holding.availableQuantity : 100} initialReason={settings.defaultBuyReason} initialSide={tradeTarget.side} maxQuantity={tradeTarget.side === "sell" ? tradeTarget.item.detail.holding.availableQuantity : undefined} onSubmit={submitOrder} /></div></div>}
  </section>;
}
