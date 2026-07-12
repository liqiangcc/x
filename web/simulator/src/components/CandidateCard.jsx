import CandidateEvidence from "./CandidateEvidence.jsx";

export default function CandidateCard({ candidate, onSelect }) {
  return (
    <article className="candidate-card">
      <header><span className="rank">#{candidate.rank}</span><h2>{candidate.alias}</h2></header>
      <CandidateEvidence evidence={candidate.evidence} />
      {candidate.qualityIssues?.length > 0 && <p className="quality-note">近似数据 · {candidate.qualityIssues.length} 项质量说明</p>}
      <button className="secondary-button" onClick={() => onSelect(candidate)} type="button">查看走势并交易</button>
    </article>
  );
}
