import { useEffect, useState } from "react";
import AdvancedConfigEditor from "../components/AdvancedConfigEditor.jsx";
import ErrorNotice from "../components/ErrorNotice.jsx";
import SelectionConfig from "../components/SelectionConfig.jsx";
import { DEFAULT_SELECTION } from "./CreateSessionPage.jsx";
import { useSession } from "../state/SessionContext.jsx";

export default function StrategiesPage() {
  const { busy, client, error, run } = useSession();
  const [strategies, setStrategies] = useState([]);
  const [name, setName] = useState("我的突破策略");
  const [config, setConfig] = useState(DEFAULT_SELECTION);

  function reload() {
    return run(() => client.getStrategies()).then((result) => setStrategies(result.strategies));
  }
  useEffect(() => {
    reload().catch(() => {});
    const timer = window.setInterval(() => client.getStrategies().then((result) => setStrategies(result.strategies)).catch(() => {}), 1500);
    return () => window.clearInterval(timer);
  }, []);

  async function save(event) {
    event.preventDefault();
    await run(() => client.createStrategy({ config, name }));
    await reload();
  }

  return <section><p className="eyebrow">配置驱动 · 可复用</p><h1>策略模板</h1><ErrorNotice error={error} />
    <div className="create-grid"><form className="panel form-card" onSubmit={save}><label>策略名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><SelectionConfig onChange={setConfig} value={config} /><AdvancedConfigEditor onChange={setConfig} value={config} /><button className="primary-button" disabled={busy}>保存为新模板</button></form>
      <div className="panel form-card"><h2>已有策略</h2>{strategies.map((strategy) => <div className="order-row" key={strategy.id}><strong>{strategy.name}</strong><small>版本 {strategy.version}{strategy.isSystem ? " · 系统默认" : ""} · {strategy.status === "ready" ? `索引完成（${strategy.buildProgress?.signalCount ?? 0} 条信号）` : `正在构建：${strategy.buildProgress?.phase ?? strategy.status} ${strategy.buildProgress?.completed ?? 0}/${strategy.buildProgress?.total ?? 0}`}</small>{strategy.status === "failed" && <button className="text-button" onClick={() => run(() => client.rebuildStrategy(strategy.id))}>重新构建</button>}{!strategy.isSystem && <button className="text-button danger-button" onClick={async () => { await run(() => client.deleteStrategy(strategy.id)); await reload(); }}>删除</button>}</div>)}</div></div>
  </section>;
}
