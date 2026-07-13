import { useState } from "react";
import { DEFAULT_SETTINGS, useSession } from "../state/SessionContext.jsx";

export default function SettingsPage() {
  const { settings, setSettings } = useSession();
  const [defaultBuyAmount, setDefaultBuyAmount] = useState(settings.defaultBuyAmount);
  const [defaultBuyReason, setDefaultBuyReason] = useState(settings.defaultBuyReason);
  const [defaultSellReturnPct, setDefaultSellReturnPct] = useState(settings.defaultSellReturnPct);
  const [saved, setSaved] = useState(false);
  const valid = Number.isFinite(Number(defaultBuyAmount)) && Number(defaultBuyAmount) >= 100 && Number(defaultBuyAmount) % 100 === 0
    && Number.isFinite(Number(defaultSellReturnPct)) && Number(defaultSellReturnPct) >= 0;
  function save(event) {
    event.preventDefault();
    if (!valid) return;
    setSettings({ ...settings, defaultBuyAmount: Number(defaultBuyAmount), defaultBuyReason: defaultBuyReason.trim(), defaultSellReturnPct: Number(defaultSellReturnPct) });
    setSaved(true);
  }
  return <section><p className="eyebrow">浏览器全局配置</p><h1>设置</h1><form className="panel settings-form" onSubmit={save}><label>默认买入金额（元）<input min="100" required step="100" type="number" value={defaultBuyAmount} onChange={(event) => { setDefaultBuyAmount(event.target.value); setSaved(false); }} /></label><label>默认买入理由<textarea rows="3" value={defaultBuyReason} onChange={(event) => { setDefaultBuyReason(event.target.value); setSaved(false); }} /></label><label>止盈提示收益率（%）<input min="0" required step="0.1" type="number" value={defaultSellReturnPct} onChange={(event) => { setDefaultSellReturnPct(event.target.value); setSaved(false); }} /></label><p>推进交易日后，收益率达到止盈提示且可卖的自选持仓会自动打开卖出订单窗口。</p><div><button className="primary-button" disabled={!valid} type="submit">保存全局设置</button><button className="text-button" onClick={() => { setDefaultBuyAmount(DEFAULT_SETTINGS.defaultBuyAmount); setDefaultBuyReason(DEFAULT_SETTINGS.defaultBuyReason); setDefaultSellReturnPct(DEFAULT_SETTINGS.defaultSellReturnPct); setSaved(false); }} type="button">恢复默认</button></div>{saved && <p className="settings-saved" role="status">已保存：¥{Number(settings.defaultBuyAmount).toLocaleString("zh-CN")} / 止盈 {settings.defaultSellReturnPct}%</p>}</form></section>;
}
