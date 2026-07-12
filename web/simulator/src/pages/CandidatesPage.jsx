import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CandidateCard from "../components/CandidateCard.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import { useSession } from "../state/SessionContext.jsx";

export default function CandidatesPage() {
  const navigate = useNavigate();
  const { busy, client, error, run, session, sessionId, setSelectedCandidate, setSession } = useSession();
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [viewAll, setViewAll] = useState(false);
  const [identities, setIdentities] = useState([]);

  useEffect(() => {
    if (!sessionId) return;
    run(() => client.getCandidates(sessionId, `?page=${page}&pageSize=20&viewAll=${viewAll}`)).then(setResult).catch(() => {});
  }, [client, page, run, sessionId, viewAll]);

  if (!sessionId) return <section><h1>匿名候选池</h1><p>请先创建练习会话。</p><Link className="primary-link" to="/create">前往创建</Link></section>;
  const pagination = result?.pagination;

  async function reveal() {
    const response = await run(() => client.reveal(sessionId, session.version));
    setIdentities(response.identities);
    setSession({ ...session, revealedAt: response.revealedAt, version: response.sessionVersion });
  }

  async function clone() {
    const child = await run(() => client.cloneSession(sessionId, { expectedVersion: session.version, selection: session.config.selection }));
    setSession(child);
    setPage(1);
  }

  function select(candidate) {
    setSelectedCandidate(candidate);
    navigate("/trade");
  }

  return (
    <section>
      <div className="page-heading-row"><div><p className="eyebrow">身份默认隐藏</p><h1>匿名候选池</h1></div><span className="data-badge">近似历史数据</span></div>
      <ErrorNotice error={error} />
      <div className="candidate-layout">
        <aside className="panel candidate-config">
          <h2>已冻结配置</h2>
          <dl><div><dt>策略</dt><dd>四年连续下跌后首次突破</dd></div><div><dt>日期</dt><dd>{session.clock.currentDate}</dd></div><div><dt>排序</dt><dd>突破幅度由小到大</dd></div></dl>
          <button className="secondary-button" disabled={busy} onClick={clone} type="button">克隆并调整配置</button>
          {session.mode !== "blind" && !session.revealedAt && <button className="text-button" disabled={busy} onClick={reveal} type="button">显式揭晓身份</button>}
          {identities.length > 0 && <ul className="identity-list">{identities.map((item) => <li key={item.candidateId}>{item.alias} · {item.code}</li>)}</ul>}
        </aside>
        <details className="panel mobile-config"><summary>查看候选配置</summary><p>连续四年下跌，本年度今日首次收盘突破去年最高价。</p></details>
        <div className="candidate-results">
          <div className="result-toolbar"><span>{pagination ? `${pagination.total} 个候选` : "加载候选…"}</span>{pagination?.total > 20 && <button className="text-button" onClick={() => setViewAll(!viewAll)} type="button">{viewAll ? "恢复分页" : "查看全部"}</button>}</div>
          <div className="candidate-list">{pagination?.items.map((candidate) => <CandidateCard candidate={candidate} key={candidate.candidateId} onSelect={select} />)}</div>
          {pagination && !viewAll && pagination.totalPages > 1 && <div className="pager"><button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {pagination.totalPages}</span><button disabled={page === pagination.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>}
          {pagination?.total === 0 && <div className="empty-state"><strong>当日没有符合条件的候选</strong><span>可以克隆会话调整规则，或选择其他历史日期。</span></div>}
        </div>
      </div>
    </section>
  );
}
