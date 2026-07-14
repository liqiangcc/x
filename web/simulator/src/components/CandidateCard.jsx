import CandidateEvidence from "./CandidateEvidence.jsx";
import { securityLabel } from "../utils/securityDisplay.js";

export default function CandidateCard({ anonymousMode = true, candidate, onAdd, onSelect }) {
  return (
    <article className="candidate-card">
      <header><span className="rank">#{candidate.rank}</span><h2>{securityLabel(candidate, anonymousMode)}</h2></header>
      <CandidateEvidence anonymousMode={anonymousMode} evidence={candidate.evidence} />
      {candidate.qualityIssues?.length > 0 && <p className="quality-note">近似数据 · {candidate.qualityIssues.length} 项质量说明</p>}
      <div className="review-actions"><button className="secondary-button" onClick={() => onSelect(candidate)} type="button">查看走势并交易</button>{onAdd && <button className="text-button" onClick={() => onAdd(candidate)} type="button">加入自选</button>}</div>
    </article>
  );
}
