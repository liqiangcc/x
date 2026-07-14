function value(number, suffix = "") {
  return Number.isFinite(number) ? `${number.toFixed(2)}${suffix}` : "—";
}

function signed(number, suffix = "") {
  return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${number.toFixed(2)}${suffix}` : "—";
}

export default function CandidateEvidence({ anonymousMode = true, evidence = {} }) {
  const metrics = [
    ["现价", value(evidence.today_close)],
    ["当日涨幅", signed(evidence.today_change_pct, "%")],
    ["突破", value(evidence.breakout_margin_pct, "%")],
    ["去年高", value(evidence.previous_year_high)],
    ["此前高收", value(evidence.max_previous_current_year_close)],
  ];
  return <div className="candidate-evidence">{metrics.map(([label, metric], index) => <span className="candidate-evidence-value" key={label}>{index > 0 && <i aria-hidden="true">/</i>}<strong aria-label={`${label} ${metric}`} className={label === "当日涨幅" && Number.isFinite(evidence.today_change_pct) ? evidence.today_change_pct < 0 ? "loss-text" : "positive-text" : ""} title={`${label}：${metric}`}>{metric}</strong></span>)}</div>;
}
