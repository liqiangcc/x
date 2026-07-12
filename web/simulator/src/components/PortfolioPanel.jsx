function money(value) {
  return Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export default function PortfolioPanel({ portfolio }) {
  if (!portfolio) return <div className="portfolio-loading">加载账户…</div>;
  return (
    <div className="portfolio-panel">
      <div className="equity-number"><span>账户权益</span><strong>¥{money(portfolio.equity)}</strong></div>
      <div className="portfolio-stats"><div><span>可用现金</span><strong>¥{money(portfolio.cashAvailable)}</strong></div><div><span>冻结资金</span><strong>¥{money(portfolio.frozenCash)}</strong></div><div><span>持仓市值</span><strong>¥{money(portfolio.marketValue)}</strong></div><div><span>总盈亏</span><strong>¥{money((portfolio.realizedPnl ?? 0) + (portfolio.unrealizedPnl ?? 0))}</strong></div></div>
      {portfolio.positions?.length > 0 && <div className="position-list">{portfolio.positions.map((position) => <div className="position-row" key={position.candidateId}><strong>{position.alias}</strong><span>{position.quantity} 股 · 可卖 {position.availableQuantity}</span><span>成本 ¥{money(position.averageCost)}</span></div>)}</div>}
    </div>
  );
}

export { money };
