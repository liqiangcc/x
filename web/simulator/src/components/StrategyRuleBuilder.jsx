import { useMemo, useState } from "react";

function uniqueKey(prefix, values) {
  let index = 1;
  while (values.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function defaults(schema = {}) {
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, value.default]));
}

function labelFor(value) {
  return ({ asc: "升序", desc: "降序", down: "下穿", eq: "等于", gt: ">", gte: "≥", lt: "<", lte: "≤", up: "上穿" })[value] ?? value;
}

function ParamEditor({ booleanFeatures, params, schema, onChange, operands, value }) {
  const current = value ?? schema.default;
  if (schema.type === "boolean") return <select value={String(current)} onChange={(event) => onChange(event.target.value === "true")}><option value="true">成立</option><option value="false">不成立</option></select>;
  if (schema.type === "enum") return <select value={current} onChange={(event) => onChange(event.target.value)}>{schema.options.map((option) => <option key={option} value={option}>{labelFor(option)}</option>)}</select>;
  if (schema.type === "booleanFeature") return <select value={current} onChange={(event) => onChange(event.target.value)}>{booleanFeatures.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>;
  if (schema.type === "operand") return <select value={current} onChange={(event) => onChange(event.target.value)}>{operands.map((operand) => <option key={operand} value={operand}>{operand}</option>)}</select>;
  const max = schema.maxFrom ? params[schema.maxFrom] : schema.max;
  return <input max={max} min={schema.min} step={schema.type === "integer" ? 1 : 0.1} type="number" value={current} onChange={(event) => onChange(schema.type === "integer" ? Number.parseInt(event.target.value, 10) : Number(event.target.value))} />;
}

function CapabilityFields({ booleanFeatures, descriptor, onChange, operands, params }) {
  return <div className="builder-fields">{Object.entries(descriptor?.paramSchema ?? {}).map(([name, schema]) => <label key={name}>{name}<ParamEditor booleanFeatures={booleanFeatures} params={params} schema={schema} onChange={(value) => onChange({ ...params, [name]: value })} operands={operands} value={params[name]} /></label>)}</div>;
}

export default function StrategyRuleBuilder({ catalog, definition = {}, onChange }) {
  const [indicatorType, setIndicatorType] = useState(catalog.indicators[0]?.id ?? "moving_average");
  const [ruleType, setRuleType] = useState(catalog.rules[0]?.id ?? "sequence_compare");
  const indicators = definition.indicators ?? [];
  const rules = definition.rules ?? [];
  const operands = useMemo(() => [
    ...catalog.features.map((item) => item.id),
    ...indicators.flatMap((indicator) => (catalog.indicators.find((item) => item.id === indicator.type)?.outputs ?? []).map((output) => `indicator.${indicator.key}.${output}`)),
  ], [catalog, indicators]);

  function replace(patch) {
    const next = {
      composition: definition.composition ?? { operator: "all", ruleKeys: rules.map((rule) => rule.key) },
      emission: definition.emission ?? { mode: "on_match" },
      indicators,
      ranking: definition.ranking ?? [{ direction: "asc", nulls: "last", operand: { id: "daily.today.close", kind: "feature" } }],
      rules,
      schemaVersion: 3,
      type: "composite",
      ...patch,
    };
    next.composition = { operator: "all", ruleKeys: next.rules.map((rule) => rule.key) };
    onChange(next);
  }

  function addIndicator() {
    const descriptor = catalog.indicators.find((item) => item.id === indicatorType);
    const key = uniqueKey(indicatorType, new Set(indicators.map((item) => item.key)));
    replace({ indicators: [...indicators, { key, params: defaults(descriptor.paramSchema), type: indicatorType }] });
  }

  function addRule() {
    const descriptor = catalog.rules.find((item) => item.id === ruleType);
    const key = uniqueKey(ruleType, new Set(rules.map((item) => item.key)));
    replace({ rules: [...rules, { key, params: defaults(descriptor.paramSchema), type: ruleType }] });
  }

  function removeIndicator(index) {
    const indicator = indicators[index];
    if (JSON.stringify(rules).includes(`indicator.${indicator.key}.`)) return window.alert("该指标仍被规则引用，请先修改或删除相关规则。");
    replace({ indicators: indicators.filter((_item, itemIndex) => itemIndex !== index) });
  }

  const ranking = definition.ranking?.[0] ?? { direction: "asc", nulls: "last", operand: { id: "daily.today.close", kind: "feature" } };
  return <div className="strategy-builder">
    <section className="builder-section"><div className="builder-heading"><div><strong>指标</strong><small>能力目录定义参数，指标只负责计算数值</small></div><div><select aria-label="新增指标类型" value={indicatorType} onChange={(event) => setIndicatorType(event.target.value)}>{catalog.indicators.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button className="secondary-button" onClick={addIndicator} type="button">添加指标</button></div></div>
      {indicators.length === 0 ? <p className="builder-empty">当前策略直接使用原始日线和年线特征。</p> : <div className="builder-card-list">{indicators.map((indicator, index) => { const descriptor = catalog.indicators.find((item) => item.id === indicator.type); return <article className="builder-card" key={indicator.key}><header><strong>{indicator.key}</strong><span>{descriptor?.label}</span><button className="text-button danger-button" onClick={() => removeIndicator(index)} type="button">删除</button></header><CapabilityFields booleanFeatures={catalog.booleanFeatures} descriptor={descriptor} operands={operands} params={indicator.params} onChange={(params) => replace({ indicators: indicators.map((item, itemIndex) => itemIndex === index ? { ...item, params } : item) })} /></article>; })}</div>}
    </section>
    <section className="builder-section"><div className="builder-heading"><div><strong>规则</strong><small>当前使用 AND 编排，规则实现来自能力注册表</small></div><div><select aria-label="新增规则类型" value={ruleType} onChange={(event) => setRuleType(event.target.value)}>{catalog.rules.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button className="secondary-button" onClick={addRule} type="button">添加规则</button></div></div>
      <div className="builder-card-list">{rules.map((rule, index) => { const descriptor = catalog.rules.find((item) => item.id === rule.type); return <article className="builder-card rule-card" key={rule.key}><header><strong>{rule.key}</strong><span>{descriptor?.label}</span><button className="text-button danger-button" onClick={() => replace({ rules: rules.filter((_item, itemIndex) => itemIndex !== index) })} type="button">删除</button></header><CapabilityFields booleanFeatures={catalog.booleanFeatures} descriptor={descriptor} operands={operands} params={rule.params} onChange={(params) => replace({ rules: rules.map((item, itemIndex) => itemIndex === index ? { ...item, params } : item) })} /></article>; })}</div>
      {rules.length === 0 && <p className="field-error">至少添加一条规则。</p>}
    </section>
    <section className="builder-section"><div className="builder-heading"><div><strong>信号与排序</strong><small>机制配置与具体规则解耦</small></div></div><div className="builder-fields"><label>发出信号<select value={definition.emission?.mode ?? "on_match"} onChange={(event) => replace({ emission: { mode: event.target.value } })}><option value="on_match">每个满足日</option><option value="on_enter">仅首次进入满足状态</option></select></label><label>候选排序<select value={ranking.operand?.kind === "feature" ? ranking.operand.id : "daily.today.close"} onChange={(event) => replace({ ranking: [{ ...ranking, operand: { id: event.target.value, kind: "feature" } }] })}>{catalog.features.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>方向<select value={ranking.direction} onChange={(event) => replace({ ranking: [{ ...ranking, direction: event.target.value }] })}><option value="asc">升序</option><option value="desc">降序</option></select></label></div></section>
    <div className="strategy-preview"><span>执行计划</span><strong>{rules.length} 条规则 AND · {definition.emission?.mode === "on_enter" ? "状态进入时触发" : "满足即触发"}</strong><small>界面字段全部由后端能力目录的参数模式生成。</small></div>
  </div>;
}
