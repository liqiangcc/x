export default function SelectionConfig({ disabled = false, value, onChange }) {
  function update(field, nextValue) {
    onChange({ ...value, [field]: nextValue });
  }
  return (
    <fieldset className="form-section" disabled={disabled}>
      <legend>默认候选规则</legend>
      <label>
        策略
        <select value={value.strategy?.type ?? "year_decline_close_breakout"} onChange={(event) => update("strategy", { ...value.strategy, type: event.target.value })}>
          <option value="year_decline_close_breakout">连续四年下跌后首次突破</option>
        </select>
      </label>
      <div className="field-row">
        <label>
          连续下跌次数
          <input min="1" type="number" value={value.strategy?.downTransitions ?? 3} onChange={(event) => update("strategy", { ...value.strategy, downTransitions: Number(event.target.value) })} />
        </label>
        <label>
          每页数量
          <input min="1" type="number" value={value.limit ?? 20} onChange={(event) => update("limit", Number(event.target.value))} />
        </label>
      </div>
      <label className="check-row">
        <input checked={value.excludeSpecialTreatment !== false} type="checkbox" onChange={(event) => update("excludeSpecialTreatment", event.target.checked)} />
        排除可可靠识别的 ST、*ST 和退市整理
      </label>
    </fieldset>
  );
}
