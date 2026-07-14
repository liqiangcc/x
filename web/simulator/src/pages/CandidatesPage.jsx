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

export default function CandidatesPage() {
  const navigate = useNavigate();
  const { busy, client, error, run, session, sessionId, setSelectedCandidate, settings } = useSession();
  const [result, setResult] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [strategyId, setStrategyId] = useState("system-year-decline-breakout");
  const [marketFilter, setMarketFilter] = useState("all");

  useEffect(() => {
    if (!sessionId) return;
    Promise.all([client.getAccountCandidates(sessionId), client.getStrategies()]).then(([candidates, templates]) => {
      setResult(candidates);
      setStrategies(templates.strategies);
      setStrategyId(session.strategyId ?? templates.strategies[0]?.id);
    }).catch(() => {});
  }, [client, session?.clock?.currentDate, sessionId]);

  if (!sessionId) return <section><h1>候选池</h1><Link to="/accounts/new">请先新建账号</Link></section>;
  const sourceItems = result?.pagination?.items ?? [];
  const items = sourceItems.filter((candidate) => marketFilter === "all" || candidateMarketBoard(candidate) === marketFilter).sort(priceAscending);

  async function selectStrategy(nextStrategyId) {
    setStrategyId(nextStrategyId);
    const response = await run(() => client.calculateCandidates(sessionId, { expectedVersion: session.version, strategyId: nextStrategyId }));
    setResult({ calculated: true, pagination: { items: response.snapshot.candidates, total: response.snapshot.candidates.length } });
  }
  async function add(candidateId) { await run(() => client.addWatchlist(sessionId, candidateId)); }
  function open(candidate) {
    setSelectedCandidate(candidate);
    navigate(`/accounts/${sessionId}/stocks/${candidate.candidateId}`);
  }

  return <section><div className="page-heading-row"><div><p className="eyebrow">当前决策日 · 索引查询</p><h1>{settings.anonymousMode ? "匿名候选池" : "候选池"}</h1></div><span className="data-badge">{tradingDayLabel({ anonymousMode: settings.anonymousMode, date: session.clock.currentDate, dayIndex: session.dayIndex ?? 1 })}</span></div><ErrorNotice error={error} />
    <div className="panel result-toolbar"><label>策略<select value={strategyId} onChange={(event) => selectStrategy(event.target.value)}>{strategies.filter((strategy) => !strategy.archived).map((strategy) => <option disabled={strategy.status !== "ready"} key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label><label>板块<select aria-label="候选板块" value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)}><option value="all">全部</option><option value="mainBoard">主板</option><option value="chiNext">创业板</option><option value="starMarket">科创板</option><option value="beijingExchange">北交所</option></select></label><span>{items.length}/{sourceItems.length} 只</span>{items.length > 0 && <button className="secondary-button" onClick={() => run(() => client.addWatchlistBulk(sessionId, items.map((item) => item.candidateId)))}>当前筛选全部加入</button>}</div>
    {!result?.calculated && <div className="empty-state"><strong>策略索引尚未就绪</strong></div>}
    <div className="candidate-list">{items.map((candidate) => <CandidateCard anonymousMode={settings.anonymousMode} candidate={candidate} key={candidate.candidateId} onAdd={() => add(candidate.candidateId)} onSelect={open} />)}</div>
    {result?.calculated && items.length === 0 && <div className="empty-state"><strong>当前日期没有符合策略的股票</strong></div>}
  </section>;
}

export { priceAscending };
