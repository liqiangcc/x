import { Link } from "react-router-dom";

const STATUS_LABELS = { empty: "无数据", invalid: "损坏", ok: "正常", selected: "策略集合" };

export default function DataStatusDetail({ busy = false, detail, onClose, onPage }) {
  if (!detail) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div aria-label={detail.title} className="panel data-detail-modal" role="dialog"><div className="modal-heading"><div><strong>{detail.title}</strong><small>{detail.loading ? "加载中…" : `共 ${detail.total.toLocaleString("zh-CN")} 条`}</small></div><button className="text-button" onClick={onClose} type="button">关闭</button></div>
    <div className="data-detail-list">{detail.items?.map((item) => <Link key={item.code} onClick={onClose} to={`/data/stocks/${item.code}`}><span className="data-detail-identity"><strong>{item.name ?? "名称未知"}</strong><code>{item.code}</code></span><span className="data-detail-value">{item.date ?? STATUS_LABELS[item.status] ?? "—"}</span></Link>)}</div>
    {!detail.loading && detail.total === 0 && <div className="empty-state compact-empty"><strong>没有对应数据</strong></div>}
    {(detail.totalPages ?? 0) > 1 && <div className="pager"><button disabled={busy || detail.page <= 1} onClick={() => onPage(detail.page - 1)} type="button">上一页</button><span>{detail.page}/{detail.totalPages}</span><button disabled={busy || detail.page >= detail.totalPages} onClick={() => onPage(detail.page + 1)} type="button">下一页</button></div>}
  </div></div>;
}
