import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CandidateCard from "../components/CandidateCard.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import { useSession } from "../state/SessionContext.jsx";
import { candidateMarketBoard, tradingDayLabel } from "../utils/securityDisplay.js";

function priceAscending(left, right) {
  const leftPrice = Number(left.evidence?.today_close);
  const rightPrice = Number(right.evidence?.today_close);
  const leftMissing = !Number.isFinite(leftPrice);
  const rightMissing = !Number.isFinite(rightPrice);
  if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
  return leftPrice - rightPrice;
}

const DEFAULT_MARKET_FILTERS = ["mainBoard", "chiNext"];
const MARKET_FILTER_OPTIONS = [
  ["mainBoard", "主板"],
  ["chiNext", "创业板"],
  ["starMarket", "科创板"],
  ["beijingExchange", "北交所"],
];

function matchesMarketFilters(candidate, filters) {
  return filters.has(candidateMarketBoard(candidate));
}

export default function CandidatesPage() {
  const navigate = useNavigate();
  const { busy, client, error, run, session, sessionId, setSelectedCandidate, settings } = useSession();
  const [result, setResult] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [strategyId, setStrategyId] = useState("system-year-decline-breakout");
  const [marketFilters, setMarketFilters] = useState(() => new Set(DEFAULT_MARKET_FILTERS));
  const [addedIds, setAddedIds] = useState(() => new Set());
  const [bulkAdding, setBulkAdding] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setAddedIds(new Set());
    Promise.all([
      client.getAccountCandidates(sessionId),
      client.getStrategies(),
      client.getWatchlist(sessionId).catch(() => ({ items: [] })),
    ]).then(([candidates, templates, watchlist]) => {
      setResult(candidates);
      setStrategies(templates.strategies);
      setStrategyId(session.strategyId ?? templates.strategies[0]?.id);
      setAddedIds(new Set((watchlist.items ?? []).map((item) => item.candidateId)));
    }).catch(() => {});
  }, [client, session?.clock?.currentDate, sessionId]);

  if (!sessionId) return <section><h1>候选池</h1><Link to="/accounts/new">请先新建账号</Link></section>;
  const sourceItems = result?.pagination?.items ?? [];
  const items = sourceItems.filter((candidate) => matchesMarketFilters(candidate, marketFilters)).sort(priceAscending);

  function toggleMarketFilter(board, checked) {
    setMarketFilters((current) => {
      const next = new Set(current);
      if (checked) next.add(board);
      else next.delete(board);
      return next;
    });
  }

  async function selectStrategy(nextStrategyId) {
    setStrategyId(nextStrategyId);
    const response = await run(() => client.calculateCandidates(sessionId, { expectedVersion: session.version, strategyId: nextStrategyId }));
    setResult({ calculated: true, pagination: { items: response.snapshot.candidates, total: response.snapshot.candidates.length } });
  }
  async function add(candidateId) {
    await run(() => client.addWatchlist(sessionId, candidateId));
    setAddedIds((current) => new Set(current).add(candidateId));
  }
  async function addAll() {
    if (bulkAdding || items.length === 0) return;
    setBulkAdding(true);
    try {
      await run(() => client.addWatchlistBulk(sessionId, items.map((item) => item.candidateId)));
      setAddedIds((current) => new Set([...current, ...items.map((item) => item.candidateId)]));
    } finally {
      setBulkAdding(false);
    }
  }
  function open(candidate) {
    setSelectedCandidate(candidate);
    navigate(`/accounts/${sessionId}/stocks/${candidate.candidateId}`);
  }

  return <section><div className="page-heading-row"><div><p className="eyebrow">当前决策日 · 索引查询</p><h1>{settings.anonymousMode ? "匿名候选池" : "候选池"}</h1></div><span className="data-badge">{tradingDayLabel({ anonymousMode: settings.anonymousMode, date: session.clock.currentDate, dayIndex: session.dayIndex ?? 1 })}</span></div><ErrorNotice error={error} />
    <div className="panel result-toolbar candidate-toolbar"><label className="candidate-strategy-filter">策略<select value={strategyId} onChange={(event) => selectStrategy(event.target.value)}>{strategies.filter((strategy) => !strategy.archived).map((strategy) => <option disabled={strategy.status !== "ready"} key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label><details className="candidate-market-filter"><summary>板块 {marketFilters.size}</summary><div>{MARKET_FILTER_OPTIONS.map(([board, label]) => <label key={board}><input checked={marketFilters.has(board)} onChange={(event) => toggleMarketFilter(board, event.target.checked)} type="checkbox" />{label}</label>)}</div></details><span>{items.length}/{sourceItems.length} 只</span>{items.length > 0 && <button className="secondary-button" disabled={bulkAdding || items.every((item) => addedIds.has(item.candidateId))} onClick={addAll}>{bulkAdding ? "加入中…" : items.every((item) => addedIds.has(item.candidateId)) ? `✓ ${items.length} 只` : "全部自选"}</button>}</div>
    {!result?.calculated && <div className="empty-state"><strong>策略索引尚未就绪</strong></div>}
    <div className="candidate-list">{items.map((candidate) => <CandidateCard added={addedIds.has(candidate.candidateId)} anonymousMode={settings.anonymousMode} candidate={candidate} key={candidate.candidateId} onAdd={() => add(candidate.candidateId)} onSelect={open} />)}</div>
    {result?.calculated && items.length === 0 && <div className="empty-state"><strong>当前日期没有符合策略的股票</strong></div>}
  </section>;
}

export { DEFAULT_MARKET_FILTERS, matchesMarketFilters, priceAscending };
