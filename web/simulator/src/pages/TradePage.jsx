import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DailyChart from "../charts/DailyChart.jsx";
import YearlyChart from "../charts/YearlyChart.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import { useSession } from "../state/SessionContext.jsx";

export default function TradePage() {
  const { client, error, run, selectedCandidate, session, sessionId } = useSession();
  const candidate = selectedCandidate ?? session?.candidateSnapshot?.candidates?.[0] ?? null;
  const [chart, setChart] = useState(null);
  const [mobileTab, setMobileTab] = useState("daily");

  useEffect(() => {
    if (!sessionId || !candidate) return;
    run(() => client.getChart(sessionId, candidate.candidateId)).then(setChart).catch(() => {});
  }, [candidate, client, run, sessionId]);

  if (!sessionId) return <section><h1>交易工作台</h1><p>请先创建会话并选择候选。</p><Link className="primary-link" to="/create">创建会话</Link></section>;
  if (!candidate) return <section><h1>交易工作台</h1><p>当前日期没有候选，请返回候选池调整配置。</p><Link className="primary-link" to="/candidates">返回候选池</Link></section>;

  return (
    <section>
      <div className="page-heading-row"><div><p className="eyebrow">D 日决策 · D+1 开盘</p><h1>{candidate.alias}</h1></div><span className="data-badge">近似价格</span></div>
      <ErrorNotice error={error} />
      <div className="mobile-chart-tabs" role="tablist"><button aria-selected={mobileTab === "daily"} onClick={() => setMobileTab("daily")} role="tab">日线 + BOLL</button><button aria-selected={mobileTab === "yearly"} onClick={() => setMobileTab("yearly")} role="tab">年线</button></div>
      <div className="trade-chart-grid">
        <div className={`panel chart-panel ${mobileTab === "daily" ? "mobile-active" : ""}`}><header><h2>日线 / BOLL / 成交量</h2><span>截至 {session.clock.currentDate}</span></header>{chart ? <DailyChart rows={chart.daily} /> : <div className="chart-loading">加载图表…</div>}</div>
        <div className={`panel chart-panel yearly-panel ${mobileTab === "yearly" ? "mobile-active" : ""}`}><header><h2>年线</h2><span>连续年度走势</span></header>{chart ? <YearlyChart rows={chart.yearly} /> : <div className="chart-loading">加载图表…</div>}</div>
      </div>
    </section>
  );
}
