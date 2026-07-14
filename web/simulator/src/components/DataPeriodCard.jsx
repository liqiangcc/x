function formatDate(value) {
  return value || "暂无";
}

function coverage(period) {
  if (!period?.codeCount) return "0%";
  return `${((period.latestDateCodeCount / period.codeCount) * 100).toFixed(1)}%`;
}

export default function DataPeriodCard({ onOpen, period }) {
  const name = period.period === "daily" ? "日线" : "年线";
  return <article className="panel data-status-card"><div><span>{name}</span><strong>{formatDate(period.latestDate)}</strong></div><dl>
    <div><dt>代码数</dt><dd><button className="stat-number" onClick={() => onOpen({ category: "all", title: `${name}全部代码` })} type="button">{period.codeCount.toLocaleString("zh-CN")}</button></dd></div>
    <div><dt>最新日期覆盖</dt><dd><button className="stat-number" onClick={() => onOpen({ category: "latest", title: `${name}最新日期覆盖` })} type="button">{period.latestDateCodeCount.toLocaleString("zh-CN")} / {coverage(period)}</button></dd></div>
    <div><dt>无数据 / 损坏</dt><dd><button className="stat-number" disabled={period.emptyCount === 0} onClick={() => onOpen({ category: "empty", title: `${name}无数据代码` })} type="button">{period.emptyCount}</button><span> / </span><button className="stat-number" disabled={period.invalidCount === 0} onClick={() => onOpen({ category: "invalid", title: `${name}损坏文件` })} type="button">{period.invalidCount}</button></dd></div>
  </dl><div className="data-date-list">{period.recentDateDistribution.map((item) => <button key={item.date} onClick={() => onOpen({ category: "date", date: item.date, title: `${name} ${item.date}` })} type="button"><span>{item.date}</span><strong>{item.count.toLocaleString("zh-CN")}</strong></button>)}</div></article>;
}

export { coverage, formatDate };
