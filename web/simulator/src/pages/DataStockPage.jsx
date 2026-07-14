import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DailyChart from "../charts/DailyChart.jsx";
import YearlyChart from "../charts/YearlyChart.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import { useSession } from "../state/SessionContext.jsx";

function rangeLabel(range) {
  if (!range?.start || !range?.end) return "无数据";
  return `${range.start} 至 ${range.end} · ${range.count.toLocaleString("zh-CN")} 条`;
}

export default function DataStockPage() {
  const { code } = useParams();
  const { client } = useSession();
  const [chart, setChart] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("daily");
  const [showBoll, setShowBoll] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  useEffect(() => {
    let active = true;
    setChart(null);
    setError(null);
    client.getDataStockChart(code)
      .then((result) => { if (active) setChart(result); })
      .catch((caught) => { if (active) setError(caught); });
    return () => { active = false; };
  }, [client, code]);

  const latest = chart?.daily?.at(-1);
  return <section className="stock-detail-page data-stock-page">
    <div className="page-heading-row"><div><p className="eyebrow">原始行情详情</p><h1>{chart?.security?.name ?? chart?.alias ?? code} <small>{code}</small></h1></div><Link className="secondary-button" to="/data">返回数据统计</Link></div>
    <ErrorNotice error={error} />
    {!chart && !error ? <div className="chart-loading">正在读取行情数据…</div> : chart && <>
      <div className="panel data-stock-summary"><div><span>最新收盘</span><strong>{Number.isFinite(latest?.close) ? latest.close.toFixed(2) : "—"}</strong></div><div><span>日线范围</span><strong>{rangeLabel(chart.range.daily)}</strong></div><div><span>年线范围</span><strong>{rangeLabel(chart.range.yearly)}</strong></div></div>
      {chart.qualityIssues?.length > 0 && <p className="quality-note">数据提示：{chart.qualityIssues.join(" / ")}</p>}
      <div className="mobile-chart-tabs market-chart-toolbar"><div role="tablist"><button aria-selected={tab === "daily"} onClick={() => setTab("daily")} role="tab">日K</button><button aria-selected={tab === "yearly"} onClick={() => setTab("yearly")} role="tab">年K</button></div><div className="indicator-switches"><button aria-pressed={showBoll} disabled={tab !== "daily"} onClick={() => setShowBoll((value) => !value)} type="button">BOLL</button><button aria-pressed={showVolume} disabled={tab !== "daily"} onClick={() => setShowVolume((value) => !value)} type="button">成交量</button></div></div>
      <div className="panel chart-panel mobile-active"><header><h2>{tab === "daily" ? "日K走势" : "年K走势"}</h2><span>拖动缩放 · 长按查看开高低收</span></header>{tab === "daily" ? <DailyChart anonymousMode={false} rows={chart.daily} showBoll={showBoll} showVolume={showVolume} /> : <YearlyChart anonymousMode={false} rows={chart.yearly} />}</div>
    </>}
  </section>;
}
