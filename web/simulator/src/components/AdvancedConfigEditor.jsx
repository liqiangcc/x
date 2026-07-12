import { useEffect, useState } from "react";

export default function AdvancedConfigEditor({ disabled = false, onChange, value }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState(null);
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);

  function update(nextText) {
    setText(nextText);
    try {
      const parsed = JSON.parse(nextText);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("配置必须是 JSON 对象");
      setError(null);
      onChange(parsed);
    } catch (caught) {
      setError(`JSON 配置错误：${caught.message}`);
    }
  }

  return (
    <details className="advanced-config">
      <summary>高级 JSON 配置</summary>
      <label>
        <span className="sr-only">候选 JSON 配置</span>
        <textarea aria-invalid={Boolean(error)} disabled={disabled} rows="12" spellCheck="false" value={text} onChange={(event) => update(event.target.value)} />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
    </details>
  );
}
