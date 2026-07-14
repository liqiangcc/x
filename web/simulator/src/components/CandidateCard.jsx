import { useState } from "react";
import CandidateEvidence from "./CandidateEvidence.jsx";
import { securityLabel } from "../utils/securityDisplay.js";

export default function CandidateCard({ added = false, anonymousMode = true, candidate, onAdd, onSelect }) {
  const [adding, setAdding] = useState(false);

  async function add(event) {
    event.stopPropagation();
    if (adding || added) return;
    setAdding(true);
    try {
      await onAdd(candidate);
    } catch {
      // The shared error notice already contains the request failure.
    } finally {
      setAdding(false);
    }
  }

  return (
    <article aria-label={`查看${securityLabel(candidate, anonymousMode)}详情`} className="candidate-card candidate-card-link" onClick={() => onSelect(candidate)} onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onSelect(candidate);
    }} role="link" tabIndex={0}>
      <header><span className="rank">#{candidate.rank}</span><h2>{securityLabel(candidate, anonymousMode)}</h2>{candidate.qualityIssues?.length > 0 && <small title={`${candidate.qualityIssues.length} 项质量说明`}>近似</small>}</header>
      <CandidateEvidence anonymousMode={anonymousMode} evidence={candidate.evidence} />
      <div className="review-actions"><button className="secondary-button" onClick={(event) => { event.stopPropagation(); onSelect(candidate); }} type="button">详情</button>{onAdd && <button className={added ? "text-button candidate-added" : "text-button"} disabled={adding || added} onClick={add} type="button">{adding ? "加入中…" : added ? "✓ 已加入" : "+ 自选"}</button>}</div>
    </article>
  );
}
