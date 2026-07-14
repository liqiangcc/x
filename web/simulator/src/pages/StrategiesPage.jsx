import { useEffect, useState } from "react";
import AdvancedConfigEditor from "../components/AdvancedConfigEditor.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import SelectionConfig from "../components/SelectionConfig.jsx";
import { DEFAULT_SELECTION } from "./CreateSessionPage.jsx";
import { useSession } from "../state/SessionContext.jsx";

const BOARD_LABELS = [["mainBoard", "主板"], ["chiNext", "创业板"], ["starMarket", "科创板"], ["beijingExchange", "北交所"]];

function marketScopeLabel(config) {
  const scope = config?.universe;
  return BOARD_LABELS.filter(([key]) => !scope || scope[key] !== false).map(([, label]) => label).join("/") || "未选择市场";
}

export default function StrategiesPage() {
  const { busy, client, error, run, settings } = useSession();
  const [strategies, setStrategies] = useState([]);
  const [name, setName] = useState("我的突破策略");
  const [config, setConfig] = useState(() => ({
    ...DEFAULT_SELECTION,
    universe: {
      ...DEFAULT_SELECTION.universe,
      beijingExchange: settings.includeBeijingExchange,
      starMarket: settings.includeStarMarket,
    },
  }));
  const [editingId, setEditingId] = useState(null);
  const [syncJobs, setSyncJobs] = useState([]);

  function reload() {
    return run(() => Promise.all([client.getStrategies(), client.getStrategySyncs()])).then(([strategyResult, syncResult]) => {
      setStrategies(strategyResult.strategies);
      setSyncJobs(syncResult.jobs);
    });
  }
  useEffect(() => {
    reload().catch(() => {});
    const timer = window.setInterval(() => Promise.all([client.getStrategies(), client.getStrategySyncs()]).then(([strategyResult, syncResult]) => {
      setStrategies(strategyResult.strategies);
      setSyncJobs(syncResult.jobs);
    }).catch(() => {}), 1500);
    return () => window.clearInterval(timer);
  }, []);

  async function save(event) {
    event.preventDefault();
    await run(() => editingId ? client.updateStrategy(editingId, { config, name }) : client.createStrategy({ config, name }));
    setEditingId(null);
    await reload();
  }

  function edit(strategy) {
    setEditingId(strategy.id);
    setName(strategy.name);
    setConfig(strategy.config);
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  async function sync(strategy) {
    if (!window.confirm(`同步“${strategy.name}”所需数据？\n\n系统只更新策略筛选出的日线，本地聚合年线，随后重建策略索引。`)) return;
    const result = await run(() => client.startStrategySync(strategy.id));
    setSyncJobs((current) => [result.job, ...current.filter((job) => job.id !== result.job.id)]);
  }

  function syncJob(strategyId) {
    return syncJobs.find((job) => job.strategyId === strategyId) ?? null;
  }

  function syncLabel(job) {
    if (!job) return null;
    if (job.phase === "syncing_data") return "正在同步日线并聚合年线";
    if (job.phase === "rebuilding_strategy") return "数据完成，正在重建策略索引";
    if (job.status === "completed") return "最近同步完成";
    if (job.status === "failed") return `同步失败：${job.error}`;
    return "等待同步";
  }

  const hasMarketScope = Object.values(config.universe ?? {}).some(Boolean);

  return <section><p className="eyebrow">配置驱动 · 可复用</p><h1>策略模板</h1><ErrorNotice error={error} />
    <div className="create-grid"><form className="panel form-card" onSubmit={save}><label>策略名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><SelectionConfig onChange={setConfig} value={config} />{!hasMarketScope && <p className="field-error">至少选择一个市场板块。</p>}<AdvancedConfigEditor onChange={setConfig} value={config} /><div><button className="primary-button" disabled={busy || !hasMarketScope}>{editingId ? "保存并重建索引" : "保存为新模板"}</button>{editingId && <button className="text-button" onClick={() => setEditingId(null)} type="button">取消编辑</button>}</div></form>
      <div className="panel form-card"><h2>已有策略</h2>{strategies.map((strategy) => { const job = syncJob(strategy.id); const syncing = job?.status === "queued" || job?.status === "running"; return <div className="order-row strategy-row" key={strategy.id}><strong>{strategy.name}</strong><small>{marketScopeLabel(strategy.config)} · 版本 {strategy.version}{strategy.isSystem ? " · 系统默认" : ""} · {strategy.status === "ready" ? `索引完成（${strategy.buildProgress?.signalCount ?? 0} 条信号）` : `正在构建：${strategy.buildProgress?.phase ?? strategy.status} ${strategy.buildProgress?.completed ?? 0}/${strategy.buildProgress?.total ?? 0}`}</small>{job && <small className={`strategy-sync-state ${job.status}`}>{syncLabel(job)}</small>}<div className="strategy-row-actions"><button className="secondary-button" disabled={busy || syncing || strategy.status !== "ready"} onClick={() => sync(strategy)} type="button">{syncing ? "同步中…" : "同步最新数据"}</button>{strategy.status === "failed" && <button className="text-button" onClick={() => run(() => client.rebuildStrategy(strategy.id))}>重新构建</button>}{!strategy.isSystem && <button className="text-button" onClick={() => edit(strategy)} type="button">编辑范围</button>}{!strategy.isSystem && <button className="text-button danger-button" onClick={async () => { await run(() => client.deleteStrategy(strategy.id)); await reload(); }}>删除</button>}</div></div>; })}</div></div>
  </section>;
}
