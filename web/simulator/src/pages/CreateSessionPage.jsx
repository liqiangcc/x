import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AdvancedConfigEditor from "../components/AdvancedConfigEditor.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import SelectionConfig from "../components/SelectionConfig.jsx";
import { useSession } from "../state/SessionContext.jsx";

const DEFAULT_SELECTION = {
  excludeSpecialTreatment: true,
  limit: 20,
  orderBy: "breakout_margin_ascending",
  strategy: {
    downTransitions: 3,
    firstBreakoutScope: "current_year",
    requireConsecutiveCalendarYears: true,
    type: "year_decline_close_breakout",
  },
};

export default function CreateSessionPage() {
  const navigate = useNavigate();
  const { busy, client, error, run, session } = useSession();
  const [form, setForm] = useState({ endDate: "2026-07-31", initialCash: 100000, mode: "manual", startDate: "2026-07-01" });
  const [selection, setSelection] = useState(DEFAULT_SELECTION);
  const frozen = Boolean(session);

  async function submit(event) {
    event.preventDefault();
    await run(() => client.createSession({ ...form, initialCash: Number(form.initialCash), selection }));
    navigate("/candidates");
  }

  return (
    <section>
      <p className="eyebrow">配置驱动 · 历史日线</p>
      <h1>创建交易练习</h1>
      <p className="page-intro">身份默认隐藏。先冻结日期、资金和候选规则，再从 D 日收盘开始决策。</p>
      <ErrorNotice error={error} />
      <form className="create-grid" onSubmit={submit}>
        <div className="panel form-card">
          <fieldset className="form-section" disabled={frozen}>
            <legend>会话范围</legend>
            <div className="field-row">
              <label>开始日期<input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
              <label>结束日期<input required type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
            </div>
            <label>初始资金（元）<input min="1" required type="number" value={form.initialCash} onChange={(event) => setForm({ ...form, initialCash: event.target.value })} /></label>
            <label>练习模式<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option value="manual">普通匿名</option><option value="blind">随机盲测</option></select></label>
          </fieldset>
          {frozen ? (
            <div className="frozen-note"><strong>配置已冻结</strong><span>如需修改，请从候选页克隆会话。</span></div>
          ) : <button className="primary-button" disabled={busy} type="submit">{busy ? "正在准备数据…" : "开始匿名练习"}</button>}
        </div>
        <div className="panel form-card">
          <SelectionConfig disabled={frozen} onChange={setSelection} value={selection} />
          <AdvancedConfigEditor disabled={frozen} onChange={setSelection} value={selection} />
        </div>
      </form>
    </section>
  );
}

export { DEFAULT_SELECTION };
