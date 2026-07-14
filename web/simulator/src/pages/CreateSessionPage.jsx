import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErrorNotice from "../components/ErrorNotice.jsx";
import { useSession } from "../state/SessionContext.jsx";
import { accountLabel, tradingDayLabel } from "../utils/securityDisplay.js";

const DEFAULT_SELECTION = {
  excludeSpecialTreatment: true,
  limit: 20,
  orderBy: "breakout_margin_ascending",
  strategy: {
    indicators: [],
    operator: "all",
    rules: [
      { key: "three_year_decline", params: { comparator: "lt", continuity: "calendar_year", field: "close", selection: "latest", source: "yearly.completed", transitions: 3 }, type: "sequence_compare" },
      { key: "first_breakout", params: { baseline: "yearly.previous.high", comparator: "gt", current: "daily.today.close", historyField: "close", historySource: "daily.current_year_before_today" }, type: "first_occurrence" },
    ],
    schemaVersion: 2,
    templateId: "three_year_decline_breakout",
    type: "capability_composite",
  },
  universe: { beijingExchange: false, chiNext: true, mainBoard: true, starMarket: false },
};

export default function CreateSessionPage() {
  const navigate = useNavigate();
  const { busy, client, error, run, setSession, settings } = useSession();
  const [form, setForm] = useState({
    initialCash: 100000,
    name: "练习账号",
    startDate: "",
    startMode: "random",
    strategyId: "system-three-year-decline-breakout-v2",
  });
  const [accounts, setAccounts] = useState([]);
  const [strategies, setStrategies] = useState([]);

  useEffect(() => {
    Promise.all([client.getAccounts(), client.getStrategies()]).then(([accountResult, strategyResult]) => {
      setAccounts(accountResult.accounts);
      setStrategies(strategyResult.strategies);
      const ready = strategyResult.strategies.find((strategy) => strategy.isDefault && strategy.status === "ready" && !strategy.archived)
        ?? strategyResult.strategies.find((strategy) => strategy.status === "ready" && !strategy.archived);
      if (ready) setForm((current) => ({ ...current, strategyId: ready.id }));
    }).catch(() => {});
  }, [client]);

  async function submit(event) {
    event.preventDefault();
    const body = { ...form, initialCash: Number(form.initialCash) };
    if (body.startMode === "random") delete body.startDate;
    const account = await run(() => client.createAccount(body));
    setSession(account);
    navigate("/candidates");
  }

  return (
    <section>
      <p className="eyebrow">独立账号 · 单一时间线</p>
      <h1>新建模拟账号</h1>
      <p className="page-intro">账号独立保存资金、持仓、自选和交易历史。随机日期至少保留 60 个后续交易日。</p>
      <ErrorNotice error={error} />
      <form className="create-grid" onSubmit={submit}>
        <div className="panel form-card">
          <fieldset className="form-section">
            <legend>账号设置</legend>
            <label>账号名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>初始资金（元）<input min="1" required type="number" value={form.initialCash} onChange={(event) => setForm({ ...form, initialCash: event.target.value })} /></label>
            <label>初始策略<select value={form.strategyId} onChange={(event) => setForm({ ...form, strategyId: event.target.value })}>{strategies.filter((strategy) => !strategy.archived).map((strategy) => <option disabled={strategy.status !== "ready"} key={strategy.id} value={strategy.id}>{strategy.name} · {strategy.status === "ready" ? "可用" : "索引构建中"}</option>)}</select></label>
            <label>开始方式<select value={form.startMode} onChange={(event) => setForm({ ...form, startMode: event.target.value })}><option value="random">随机历史日期</option><option value="specified">指定开始日期</option></select></label>
            {form.startMode === "specified" && <label>开始日期<input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>}
          </fieldset>
          <button className="primary-button" disabled={busy || !strategies.some((strategy) => strategy.id === form.strategyId && strategy.status === "ready")} type="submit">{busy ? "正在创建账号…" : "创建并开始"}</button>
        </div>
      </form>
      {accounts.length > 0 && <div className="panel form-card"><h2>已有账号</h2>{accounts.map((account, index) => <div className="order-row" key={account.id}><strong>{accountLabel(account, settings.anonymousMode, index)}</strong><small>{tradingDayLabel({ anonymousMode: settings.anonymousMode, date: account.clock.currentDate, dayIndex: account.dayIndex ?? 1 })} · 可用资金 ¥{account.account.cashAvailable.toLocaleString("zh-CN")}</small><button className="secondary-button" onClick={() => { setSession(account); navigate("/candidates"); }} type="button">进入账号</button></div>)}</div>}
    </section>
  );
}

export { DEFAULT_SELECTION };
