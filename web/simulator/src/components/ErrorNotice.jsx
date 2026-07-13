export default function ErrorNotice({ error }) {
  if (!error) return null;
  const messages = {
    accepted_orders_block_skip: "存在待成交订单，请先取消订单再跳过。",
    buy_at_limit_up_open: "次日涨停开盘，买单未成交。",
    buy_requires_current_candidate: "只能买入当前交易日候选股。",
    fill_exceeds_frozen_cash: "成交金额超过冻结资金。",
    insufficient_available_cash: "可用资金不足，无法按涨停上限冻结。",
    insufficient_available_shares: "可卖股份不足；新买股份需要到下一个交易日才可卖。",
    sell_at_limit_down_open: "次日跌停开盘，卖单未成交。",
  };
  return (
    <div className="error-notice" role="alert">
      <strong>{messages[error.code] ?? error.message}</strong>
      {error.issues?.length > 0 && (
        <ul>{error.issues.map((issue, index) => <li key={`${issue.field ?? issue}-${index}`}>{issue.message ?? issue}</li>)}</ul>
      )}
    </div>
  );
}
