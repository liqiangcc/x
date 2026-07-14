export default function SelectionConfig({ disabled = false, value, onChange }) {
  function update(field, nextValue) {
    onChange({ ...value, [field]: nextValue });
  }
  return (
    <fieldset className="form-section" disabled={disabled}>
      <legend>候选范围</legend>
      <div className="field-row">
        <label>
          每页数量
          <input min="1" type="number" value={value.limit ?? 20} onChange={(event) => update("limit", Number(event.target.value))} />
        </label>
      </div>
      <label className="check-row">
        <input checked={value.excludeSpecialTreatment !== false} type="checkbox" onChange={(event) => update("excludeSpecialTreatment", event.target.checked)} />
        排除可可靠识别的 ST、*ST 和退市整理
      </label>
      <div className="field-row">
        <label className="check-row"><input checked={value.universe?.mainBoard !== false} type="checkbox" onChange={(event) => update("universe", { ...value.universe, mainBoard: event.target.checked })} />主板</label>
        <label className="check-row"><input checked={value.universe?.chiNext !== false} type="checkbox" onChange={(event) => update("universe", { ...value.universe, chiNext: event.target.checked })} />创业板</label>
        <label className="check-row"><input checked={value.universe?.starMarket === true} type="checkbox" onChange={(event) => update("universe", { ...value.universe, starMarket: event.target.checked })} />科创板</label>
        <label className="check-row"><input checked={value.universe?.beijingExchange === true} type="checkbox" onChange={(event) => update("universe", { ...value.universe, beijingExchange: event.target.checked })} />北交所</label>
      </div>
    </fieldset>
  );
}
