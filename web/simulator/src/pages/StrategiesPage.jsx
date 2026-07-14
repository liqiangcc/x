import { useEffect, useState } from "react";
import AdvancedConfigEditor from "../components/AdvancedConfigEditor.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import SelectionConfig from "../components/SelectionConfig.jsx";
import StrategyRuleBuilder from "../components/StrategyRuleBuilder.jsx";
import { DEFAULT_SELECTION } from "./CreateSessionPage.jsx";
import { useSession } from "../state/SessionContext.jsx";

const BOARD_LABELS = [["mainBoard", "主板"], ["chiNext", "创业板"], ["starMarket", "科创板"], ["beijingExchange", "北交所"]];

function marketScopeLabel(config) {
  const scope = config?.universe;
  return BOARD_LABELS.filter(([key]) => !scope || scope[key] !== false).map(([, label]) => label).join("/") || "未选择市场";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function editableDefinition(strategy) {
  if (strategy?.type === "composite" || strategy?.type === "capability_composite") return clone(strategy);
  const definition = clone(DEFAULT_SELECTION.strategy);
  definition.rules[0].params.transitions = strategy?.downTransitions ?? 3;
  return definition;
}

export default function StrategiesPage() {
  const { busy, client, error, run, settings } = useSession();
  const [strategies, setStrategies] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [name, setName] = useState("我的突破策略");
  const [config, setConfig] = useState(() => ({
    ...clone(DEFAULT_SELECTION),
    universe: { ...DEFAULT_SELECTION.universe, beijingExchange: settings.includeBeijingExchange, starMarket: settings.includeStarMarket },
  }));
  const [templateId, setTemplateId] = useState("three_year_decline_breakout");
  const [editingId, setEditingId] = useState(null);
  const [syncJobs, setSyncJobs] = useState([]);
  const [validation, setValidation] = useState(null);
  const [notice, setNotice] = useState(null);

  function reload() {
    return run(() => Promise.all([client.getStrategies(), client.getStrategySyncs(), client.getStrategyTemplates(), client.getStrategyBuilderCatalog()])).then(([strategyResult, syncResult, templateResult, catalogResult]) => {
      setStrategies(strategyResult.strategies);
      setSyncJobs(syncResult.jobs);
      setTemplates(templateResult.templates);
      setCatalog(catalogResult);
      return templateResult.templates;
    });
  }

  useEffect(() => {
    reload().catch(() => {});
    const timer = window.setInterval(() => Promise.all([client.getStrategies(), client.getStrategySyncs()]).then(([strategyResult, syncResult]) => {
      setStrategies(strategyResult.strategies);
      setSyncJobs(syncResult.jobs);
    }).catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, []);

  function applyTemplate(id, source = templates) {
    const template = source.find((item) => item.id === id);
    if (!template) return;
    setTemplateId(id);
    setConfig((current) => ({ ...current, strategy: clone(template.definition), templateOrigin: { id: template.id, revision: template.currentRevision ?? template.version } }));
    setValidation(null);
  }

  async function save(event) {
    event.preventDefault();
    setNotice(null);
    const checked = await run(() => client.validateStrategy(config.strategy));
    setValidation(checked);
    const saved = await run(() => editingId ? client.updateStrategy(editingId, { config, name }) : client.createStrategy({ config, name }));
    setStrategies((current) => [saved, ...current.filter((strategy) => strategy.id !== saved.id)]);
    setNotice(`策略“${saved.name}”已保存，索引正在后台构建。期间可以继续使用页面。`);
    setEditingId(null);
    await reload();
  }

  function edit(strategy) {
    const definition = editableDefinition(strategy.config?.strategy);
    setEditingId(strategy.id);
    setName(strategy.name);
    setTemplateId(definition.templateId ?? "custom_composite");
    setConfig({ ...clone(strategy.config), strategy: definition });
    setValidation(null);
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  async function saveAsTemplate() {
    const templateName = window.prompt("自定义模板名称", `${name}模板`);
    if (!templateName?.trim()) return;
    const created = await run(() => client.createStrategyTemplate({ definition: config.strategy, name: templateName.trim() }));
    const next = await reload();
    setTemplateId(created.id);
    setConfig((current) => ({ ...current, strategy: clone(created.definition) }));
    if (!next.some((item) => item.id === created.id)) setTemplates((current) => [...current, created]);
  }

  async function updateTemplate() {
    const template = templates.find((item) => item.id === templateId);
    if (!template || template.isSystem) return;
    const updated = await run(() => client.updateStrategyTemplate(template.id, { definition: config.strategy, description: template.description ?? "", name: template.name }));
    setConfig((current) => ({ ...current, strategy: clone(updated.definition) }));
    await reload();
  }

  async function removeTemplate(template) {
    if (!window.confirm(`删除自定义模板“${template.name}”？已创建的策略不会受影响。`)) return;
    await run(() => client.deleteStrategyTemplate(template.id));
    const next = await reload();
    if (templateId === template.id) applyTemplate("three_year_decline_breakout", next);
  }

  async function sync(strategy) {
    if (!window.confirm(`同步“${strategy.name}”所需数据？\n\n系统按策略的年线规则预筛代码，只更新所需日线，随后重建索引。`)) return;
    const result = await run(() => client.startStrategySync(strategy.id));
    setSyncJobs((current) => [result.job, ...current.filter((job) => job.id !== result.job.id)]);
  }

  function syncJob(strategyId) {
    return syncJobs.find((job) => job.strategyId === strategyId) ?? null;
  }

  function syncLabel(job) {
    if (!job) return null;
    if (job.phase === "syncing_data") return "正在同步策略所需日线并聚合年线";
    if (job.phase === "rebuilding_strategy") return "数据完成，正在重建策略索引";
    if (job.status === "completed") return "最近同步完成";
    if (job.status === "failed") return `同步失败：${job.error}`;
    return "等待同步";
  }

  const hasMarketScope = Object.values(config.universe ?? {}).some(Boolean);
  const hasEventRule = (config.strategy?.rules?.length ?? 0) > 0;
  const selectedTemplate = templates.find((item) => item.id === templateId);

  return <section><p className="eyebrow">模板派生 · 规则组合 · 配置执行</p><h1>策略编排</h1><ErrorNotice error={error} />{notice && <p className="strategy-save-notice" role="status">{notice}</p>}
    {!catalog ? <div className="chart-loading">正在加载策略能力目录…</div> : <div className="strategy-layout"><form className="panel form-card strategy-editor" onSubmit={save}><div className="template-picker"><label>策略模板<select value={templateId} onChange={(event) => applyTemplate(event.target.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.isSystem ? "预置" : "自定义"} · {template.name}</option>)}</select></label><small>{selectedTemplate?.description}</small></div><label>策略实例名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <StrategyRuleBuilder catalog={catalog} definition={config.strategy} onChange={(strategy) => { setConfig({ ...config, strategy }); setValidation(null); }} />
      <SelectionConfig onChange={setConfig} value={config} />{!hasMarketScope && <p className="field-error">至少选择一个市场板块。</p>}
      <AdvancedConfigEditor onChange={setConfig} value={config} />
      {validation && <p className="strategy-validation">校验通过：{validation.description} · 最大日线回看 {validation.requirements.maxDailyLookback} 日</p>}
      <div className="strategy-save-actions"><button className="primary-button" disabled={busy || !hasMarketScope || !hasEventRule}>{busy ? "正在保存…" : editingId ? "保存并重建索引" : "保存并构建策略"}</button><button className="secondary-button" disabled={busy} onClick={saveAsTemplate} type="button">另存为自定义模板</button>{selectedTemplate && !selectedTemplate.isSystem && <button className="secondary-button" disabled={busy} onClick={updateTemplate} type="button">更新当前模板</button>}{editingId && <button className="text-button" onClick={() => setEditingId(null)} type="button">取消编辑</button>}</div></form>
      <aside className="strategy-side"><div className="panel form-card"><h2>模板定义</h2>{templates.map((template) => <div className="order-row template-row" key={template.id}><strong>{template.name}</strong><small>{template.isSystem ? "系统预置模板" : `自定义模板 · 版本 ${template.version}`}</small><span>{template.description}</span><div><button className="text-button" onClick={() => applyTemplate(template.id)} type="button">使用模板</button>{!template.isSystem && <button className="text-button danger-button" onClick={() => removeTemplate(template)} type="button">删除</button>}</div></div>)}</div></aside></div>}
    <div className="panel form-card strategy-instance-list"><h2>可运行策略实例</h2>{strategies.map((strategy) => { const job = syncJob(strategy.id); const syncing = job?.status === "queued" || job?.status === "running"; return <div className="order-row strategy-row" key={strategy.id}><strong>{strategy.name}{strategy.isDefault ? " · 默认" : ""}</strong><small>{marketScopeLabel(strategy.config)} · 版本 {strategy.version}{strategy.isSystem ? " · 系统" : ""} · {strategy.status === "ready" ? `索引完成（${strategy.buildProgress?.signalCount ?? 0} 条信号）` : `正在构建：${strategy.buildProgress?.phase ?? strategy.status} ${strategy.buildProgress?.completed ?? 0}/${strategy.buildProgress?.total ?? 0}`}</small><span className="strategy-description">{strategy.description}</span>{job && <small className={`strategy-sync-state ${job.status}`}>{syncLabel(job)}</small>}<div className="strategy-row-actions"><button className="secondary-button" disabled={busy || syncing || strategy.status !== "ready"} onClick={() => sync(strategy)} type="button">{syncing ? "同步中…" : "同步最新数据"}</button>{strategy.status === "failed" && <button className="text-button" onClick={() => run(() => client.rebuildStrategy(strategy.id))}>重新构建</button>}{!strategy.isSystem && <button className="text-button" onClick={() => edit(strategy)} type="button">编辑策略</button>}{!strategy.isSystem && <button className="text-button danger-button" onClick={async () => { await run(() => client.deleteStrategy(strategy.id)); await reload(); }}>删除</button>}</div></div>; })}</div>
  </section>;
}
