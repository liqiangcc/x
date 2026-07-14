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
  const [proxyState, setProxyState] = useState(null);

  function load(refresh = false) {
    return run(() => client.getDataStatus(refresh)).then(setStatus);
  }

  useEffect(() => {
    load().catch(() => {});
    client.getProxyQuality().then(setProxyState).catch(() => {});
  }, []);

  const strategy = status?.strategyUniverse;
  const proxyJob = proxyState?.job;
  const proxyRunning = proxyJob?.status === "queued" || proxyJob?.status === "running";
  useEffect(() => {
    if (!proxyRunning) return undefined;
    const timer = window.setInterval(() => client.getProxyQuality().then(setProxyState).catch(() => {}), 1500);
    return () => window.clearInterval(timer);
  }, [client, proxyRunning]);

  async function refreshProxies() {
    setProxyState(await run(() => client.refreshProxyQuality()));
  }

  return <section><div className="page-heading-row"><div><p className="eyebrow">原始行情 · 同步范围</p><h1>数据统计</h1></div><button className="secondary-button" disabled={busy} onClick={() => load(true)} type="button">{busy ? "统计中…" : "重新统计"}</button></div><ErrorNotice error={error} />
    {!status ? <div className="chart-loading">正在统计原始数据…</div> : <>
      <div className="data-status-grid">{[status.periods.daily, status.periods.yearly].map((period) => <article className="panel data-status-card" key={period.period}><div><span>{period.period === "daily" ? "日线" : "年线"}</span><strong>{formatDate(period.latestDate)}</strong></div><dl><div><dt>代码数</dt><dd>{period.codeCount.toLocaleString("zh-CN")}</dd></div><div><dt>最新日期覆盖</dt><dd>{period.latestDateCodeCount.toLocaleString("zh-CN")} / {coverage(period)}</dd></div><div><dt>无数据 / 损坏</dt><dd>{period.emptyCount} / {period.invalidCount}</dd></div></dl><div className="data-date-list">{period.recentDateDistribution.map((item) => <span key={item.date}>{item.date}<strong>{item.count.toLocaleString("zh-CN")}</strong></span>)}</div></article>)}</div>
      <article className="panel strategy-data-card"><div className="strategy-data-heading"><div><span>当前策略同步集合</span><strong>{strategy ? `${strategy.codeCount.toLocaleString("zh-CN")} 只` : "尚未生成"}</strong></div>{strategy && <small>从 {strategy.sourceCodeCount.toLocaleString("zh-CN")} 只中筛选 · 缺少年线 {strategy.missingYearlyCount.toLocaleString("zh-CN")} 只</small>}</div>{strategy && <><dl><div><dt>策略</dt><dd>{strategy.strategyId}</dd></div><div><dt>适用日期</dt><dd>{strategy.asOfDate}</dd></div><div><dt>生成时间</dt><dd>{new Date(strategy.generatedAt).toLocaleString("zh-CN")}</dd></div></dl><details className="strategy-code-details"><summary>查看同步代码（{strategy.codes.length}）</summary><div>{strategy.codes.map((code) => <code key={code}>{code}</code>)}</div></details></>}</article>
      <article className="panel proxy-quality-card"><div className="strategy-data-heading"><div><span>国内出口质量</span><strong>{!proxyJob ? "尚未验证" : proxyRunning ? "验证中" : proxyJob.quality?.qualified ? "可用于同步" : "未达标"}</strong></div><button className="secondary-button" disabled={busy || proxyRunning} onClick={refreshProxies} type="button">{proxyRunning ? "刷新验证中…" : "刷新并验证"}</button></div>
        {proxyJob && <><p className="proxy-quality-phase">{proxyJob.phase === "refreshing_github" ? "正在从 GitHub 拉取最新 CN 清单" : proxyJob.phase === "validating_eastmoney" ? "正在通过东方财富真实 K 线验证" : proxyJob.error ?? `完成于 ${new Date(proxyJob.finishedAt).toLocaleString("zh-CN")}`}</p>
          {proxyJob.github && <div className="proxy-quality-source"><span>GitHub</span><strong>{proxyJob.github.repository}</strong><small>{proxyJob.github.cache} · {proxyJob.github.candidateCount} 个 · {proxyJob.github.sha?.slice(0, 8) ?? "无版本"}</small></div>}
          {proxyJob.quality && <><dl><div><dt>候选 / 可用</dt><dd>{proxyJob.quality.candidate_count} / {proxyJob.quality.available_count}</dd></div><div><dt>成功率</dt><dd>{(proxyJob.quality.success_rate * 100).toFixed(1)}%</dd></div><div><dt>P50 / P95</dt><dd>{proxyJob.quality.p50_duration_ms ?? "-"} / {proxyJob.quality.p95_duration_ms ?? "-"} ms</dd></div><div><dt>门槛</dt><dd>≥{proxyJob.quality.thresholds.minAvailable} 个 / P95≤{proxyJob.quality.thresholds.maxP95Ms}ms</dd></div></dl><div className="proxy-source-list">{proxyJob.quality.sources.map((source) => <span key={source.name}>{source.name}：拉取 {source.count} / 验证 {source.checked_count} / 可用 {source.available_count}</span>)}</div></>}
        </>}
      </article>
      <p className="data-status-note">统计结果默认缓存 5 分钟。日常同步只更新策略集合；缺少年线历史的代码单独记录，后续通过补数任务处理。</p>
    </>}
  </section>;
}
