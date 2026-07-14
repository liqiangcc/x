export function securityLabel(value, anonymousMode = true) {
  if (anonymousMode) return value?.alias ?? "匿名标的";
  const security = value?.security;
  if (!security?.code) return value?.alias ?? "未知标的";
  return security.name ? `${security.name} / ${security.code}` : security.code;
}

export function accountLabel(value, anonymousMode = true, index = null) {
  if (anonymousMode) return Number.isInteger(index) ? `练习账号 ${index + 1}` : "练习账号";
  return value?.name?.trim() || "未命名账号";
}

export function tradingDayLabel({ anonymousMode = true, date = null, dayIndex = null } = {}) {
  const relative = Number.isInteger(dayIndex) ? `第 ${dayIndex} 个交易日` : null;
  if (anonymousMode || !date) return relative ?? "交易日未知";
  return relative ? `${date} · ${relative}` : date;
}

export function candidateMarketBoard(value) {
  const code = String(value?.security?.code ?? "");
  if (/^68[89]/.test(code)) return "starMarket";
  if (/^(4|8|92)/.test(code)) return "beijingExchange";
  if (/^30[01]/.test(code)) return "chiNext";
  return "mainBoard";
}
