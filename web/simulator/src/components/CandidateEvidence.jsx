function value(number, suffix = "") {
  return Number.isFinite(number) ? `${number.toFixed(2)}${suffix}` : "—";
}

export default function CandidateEvidence({ anonymousMode = true, evidence = {} }) {
  return (
    <div className="candidate-evidence">
      <div><span>突破幅度</span><strong>{value(evidence.breakout_margin_pct, "%")}</strong></div>
      <div><span>去年最高</span><strong>{value(evidence.previous_year_high)}</strong></div>
      <div><span>此前最高收盘</span><strong>{value(evidence.max_previous_current_year_close)}</strong></div>
      <div><span>今日收盘</span><strong>{value(evidence.today_close)}</strong></div>
      {evidence.annual_points?.length > 0 && (
        <div className="annual-points"><span>连续年线</span><strong>{evidence.annual_points.map((point) => `${anonymousMode ? "" : `${point.year}: `}${value(point.close)}`).join(" → ")}</strong></div>
      )}
    </div>
  );
}
