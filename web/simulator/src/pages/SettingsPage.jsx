import { useState } from "react";
import { DEFAULT_SETTINGS, useSession } from "../state/SessionContext.jsx";

export default function SettingsPage() {
  const { settings, setSettings } = useSession();
  const [anonymousMode, setAnonymousMode] = useState(settings.anonymousMode);
  const [defaultBuyAmount, setDefaultBuyAmount] = useState(settings.defaultBuyAmount);
  const [defaultBuyReason, setDefaultBuyReason] = useState(settings.defaultBuyReason);
  const [defaultSellReturnPct, setDefaultSellReturnPct] = useState(settings.defaultSellReturnPct);
  const [includeBeijingExchange, setIncludeBeijingExchange] = useState(settings.includeBeijingExchange);
  const [includeStarMarket, setIncludeStarMarket] = useState(settings.includeStarMarket);
  const [saved, setSaved] = useState(false);
  const valid = Number.isFinite(Number(defaultBuyAmount)) && Number(defaultBuyAmount) >= 100 && Number(defaultBuyAmount) % 100 === 0
    && Number.isFinite(Number(defaultSellReturnPct)) && Number(defaultSellReturnPct) >= 0;

  function applySwitch(field, value, setter) {
    setter(value);
    setSettings((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  function save(event) {
    event.preventDefault();
    if (!valid) return;
    setSettings({
      ...settings,
      anonymousMode,
      defaultBuyAmount: Number(defaultBuyAmount),
      defaultBuyReason: defaultBuyReason.trim(),
      defaultSellReturnPct: Number(defaultSellReturnPct),
      includeBeijingExchange,
      includeStarMarket,
    });
    setSaved(true);
  }

  function restoreDefaults() {
    setAnonymousMode(DEFAULT_SETTINGS.anonymousMode);
    setDefaultBuyAmount(DEFAULT_SETTINGS.defaultBuyAmount);
    setDefaultBuyReason(DEFAULT_SETTINGS.defaultBuyReason);
    setDefaultSellReturnPct(DEFAULT_SETTINGS.defaultSellReturnPct);
    setIncludeBeijingExchange(DEFAULT_SETTINGS.includeBeijingExchange);
    setIncludeStarMarket(DEFAULT_SETTINGS.includeStarMarket);
    setSaved(false);
  }

  return <section>
    <p className="eyebrow">浏览器全局配置</p><h1>设置</h1>
    <form className="panel settings-form" onSubmit={save}>
      <label className="check-row"><input checked={anonymousMode} type="checkbox" onChange={(event) => applySwitch("anonymousMode", event.target.checked, setAnonymousMode)} />匿名练习模式（仅隐藏页面中的股票身份和年份）</label>
      <p>关闭后立即显示真实股票名称、代码和完整日期，不修改交易、持仓或复盘数据。</p>
      <fieldset className="form-section"><legend>新策略默认市场范围</legend>
        <label className="check-row"><input checked={includeStarMarket} type="checkbox" onChange={(event) => applySwitch("includeStarMarket", event.target.checked, setIncludeStarMarket)} />新策略默认包含科创板</label>
        <label className="check-row"><input checked={includeBeijingExchange} type="checkbox" onChange={(event) => applySwitch("includeBeijingExchange", event.target.checked, setIncludeBeijingExchange)} />新策略默认包含北交所</label>
        <p>只作为新建策略的初始值；已有策略的权威范围在策略页面配置。</p>
      </fieldset>
      <label>默认买入金额（元）<input min="100" required step="100" type="number" value={defaultBuyAmount} onChange={(event) => { setDefaultBuyAmount(event.target.value); setSaved(false); }} /></label>
      <label>默认买入理由<textarea rows="3" value={defaultBuyReason} onChange={(event) => { setDefaultBuyReason(event.target.value); setSaved(false); }} /></label>
      <label>止盈提示收益率（%）<input min="0" required step="0.1" type="number" value={defaultSellReturnPct} onChange={(event) => { setDefaultSellReturnPct(event.target.value); setSaved(false); }} /></label>
      <p>推进交易日后，收益率达到止盈提示且可卖的自选持仓会自动打开卖出订单窗口。</p>
      <div><button className="primary-button" disabled={!valid} type="submit">保存全局设置</button><button className="text-button" onClick={restoreDefaults} type="button">恢复默认</button></div>
      {saved && <p className="settings-saved" role="status">已保存：{settings.anonymousMode ? "匿名" : "实名"} / ¥{Number(settings.defaultBuyAmount).toLocaleString("zh-CN")} / 止盈 {settings.defaultSellReturnPct}%</p>}
    </form>
  </section>;
}
