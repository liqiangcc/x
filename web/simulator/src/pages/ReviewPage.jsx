import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ErrorNotice from "../components/ErrorNotice.jsx";
import PerformanceCharts from "../components/PerformanceCharts.jsx";
import TradeReview from "../components/TradeReview.jsx";
import StockCycleReview from "../components/StockCycleReview.jsx";
import { useSession } from "../state/SessionContext.jsx";
import { securityLabel, tradingDayLabel } from "../utils/securityDisplay.js";

function percent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "—";
}

function money(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : "-"}¥${Math.abs(value).toFixed(2)}` : "—";
}

export default function ReviewPage() {
  const { busy, client, error, run, session, sessionId, setSession, settings } = useSession();
  const [report, setReport] = useState(null);
  const [exportPath, setExportPath] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    run(() => client.getReport(sessionId)).then(setReport).catch(() => {});
  }, [client, run, sessionId]);

  if (!sessionId) return <section><h1>练习复盘</h1><p>请先完成一段交易练习。</p><Link className="primary-link" to="/create">创建会话</Link></section>;

  async function finish() {
    const next = await run(() => client.finish(sessionId, session.version));
    setSession(next);
    setReport(await client.getReport(sessionId));
  }

  async function exportReport() {
    const result = await run(() => client.exportSession(sessionId));
    setExportPath(result.filePath);
  }

  const performance = report?.performance;
  const totalProfit = performance ? performance.endingEquity - performance.initialCash : null;
  const startDate = report?.equityCurve?.[0]?.date ?? report?.session?.config?.startDate ?? null;
  const endDate = report?.session?.clock?.currentDate ?? null;
  return (
    <section>
      <div className="page-heading-row"><div><p className="eyebrow">证据与理由</p><h1>练习复盘</h1></div><span className="data-badge">近似价格</span></div>
      <ErrorNotice error={error} />
      <div className="review-actions">{session.status !== "completed" && <button className="primary-button" disabled={busy} onClick={finish}>结束并估值</button>}<button className="secondary-button" disabled={busy} onClick={exportReport}>导出 JSON</button></div>
      {exportPath && <p className="export-note">已导出：{exportPath}</p>}
      {!report ? <div className="chart-loading">加载复盘…</div> : <>
        <div className="review-meta"><p>练习区间：{tradingDayLabel({ anonymousMode: settings.anonymousMode, date: startDate, dayIndex: 1 })} → {tradingDayLabel({ anonymousMode: settings.anonymousMode, date: endDate, dayIndex: session.dayIndex ?? report.equityCurve.length })}</p><p>页面显示：{settings.anonymousMode ? "匿名" : "实名"}</p></div>
        <div className="metric-grid"><div><span>总收益</span><strong className={totalProfit < 0 ? "loss-text" : "positive-text"}>{money(totalProfit)} / {percent(performance.totalReturn)}</strong></div><div><span>期初 / 期末</span><strong>¥{performance.initialCash.toFixed(2)} / ¥{performance.endingEquity.toFixed(2)}</strong></div><div><span>已实现 / 浮动</span><strong>{money(performance.realizedPnl)} / {money(performance.unrealizedPnl)}</strong></div><div><span>胜率</span><strong>{performance.winRate == null ? "—" : percent(performance.winRate)}</strong></div><div><span>订单 / 平仓</span><strong>{performance.orderCount} / {performance.closedTradeCount}</strong></div><div><span>最大回撤</span><strong>{percent(performance.maxDrawdown)}</strong></div><div><span>年化收益</span><strong>{percent(performance.annualizedReturn)}</strong></div><div><span>Sharpe / Sortino</span><strong>{performance.sharpe.toFixed(2)} / {performance.sortino.toFixed(2)}</strong></div><div><span>费用 / 滑点</span><strong>¥{performance.fees.toFixed(2)} / ¥{performance.slippage.toFixed(2)}</strong></div></div>
        <PerformanceCharts benchmark={report.benchmark} equityCurve={report.equityCurve} />
        <StockCycleReview anonymousMode={settings.anonymousMode} cycles={report.stockCycles} />
        <TradeReview anonymousMode={settings.anonymousMode} candidates={report.candidates} fills={report.fills} orders={report.orders} />
        <div className="review-meta"><p>数据模式：历史近似成交 · 持仓按当前练习日估值</p><p>父会话：{report.lineage?.parentSessionId ?? "无"}</p>{report.account.positions?.length > 0 && <p>未平仓持仓：{report.account.positions.map((item) => `${securityLabel(item, settings.anonymousMode)} ${item.quantity}股`).join("、")}（结束估值，未强平）</p>}</div>
      </>}
    </section>
  );
}

export { money, percent };
