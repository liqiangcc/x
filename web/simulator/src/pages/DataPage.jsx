import { useEffect, useState } from "react";
import ErrorNotice from "../components/ErrorNotice.jsx";
import { useSession } from "../state/SessionContext.jsx";

function formatDate(value) {
  return value || "暂无";
}

function coverage(period) {
  if (!period?.codeCount) return "0%";
  return `${((period.latestDateCodeCount / period.codeCount) * 100).toFixed(1)}%`;
}

export default function DataPage() {
  const { busy, client, error, run } = useSession();
  const [status, setStatus] = useState(null);

  function load(refresh = false) {
    return run(() => client.getDataStatus(refresh)).then(setStatus);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const strategy = status?.strategyUniverse;
  return <section><div className="page-heading-row"><div><p className="eyebrow">原始行情 · 同步范围</p><h1>数据统计</h1></div><button className="secondary-button" disabled={busy} onClick={() => load(true)} type="button">{busy ? "统计中…" : "重新统计"}</button></div><ErrorNotice error={error} />
    {!status ? <div className="chart-loading">正在统计原始数据…</div> : <>
      <div className="data-status-grid">{[status.periods.daily, status.periods.yearly].map((period) => <article className="panel data-status-card" key={period.period}><div><span>{period.period === "daily" ? "日线" : "年线"}</span><strong>{formatDate(period.latestDate)}</strong></div><dl><div><dt>代码数</dt><dd>{period.codeCount.toLocaleString("zh-CN")}</dd></div><div><dt>最新日期覆盖</dt><dd>{period.latestDateCodeCount.toLocaleString("zh-CN")} / {coverage(period)}</dd></div><div><dt>无数据 / 损坏</dt><dd>{period.emptyCount} / {period.invalidCount}</dd></div></dl><div className="data-date-list">{period.recentDateDistribution.map((item) => <span key={item.date}>{item.date}<strong>{item.count.toLocaleString("zh-CN")}</strong></span>)}</div></article>)}</div>
      <article className="panel strategy-data-card"><div className="strategy-data-heading"><div><span>当前策略同步集合</span><strong>{strategy ? `${strategy.codeCount.toLocaleString("zh-CN")} 只` : "尚未生成"}</strong></div>{strategy && <small>从 {strategy.sourceCodeCount.toLocaleString("zh-CN")} 只中筛选 · 缺少年线 {strategy.missingYearlyCount.toLocaleString("zh-CN")} 只</small>}</div>{strategy && <><dl><div><dt>策略</dt><dd>{strategy.strategyId}</dd></div><div><dt>适用日期</dt><dd>{strategy.asOfDate}</dd></div><div><dt>生成时间</dt><dd>{new Date(strategy.generatedAt).toLocaleString("zh-CN")}</dd></div></dl><details className="strategy-code-details"><summary>查看同步代码（{strategy.codes.length}）</summary><div>{strategy.codes.map((code) => <code key={code}>{code}</code>)}</div></details></>}</article>
      <p className="data-status-note">统计结果默认缓存 5 分钟。日常同步只更新策略集合；缺少年线历史的代码单独记录，后续通过补数任务处理。</p>
    </>}
  </section>;
}
