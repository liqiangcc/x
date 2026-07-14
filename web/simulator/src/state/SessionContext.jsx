import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";

const SessionContext = createContext(null);
const DEFAULT_SETTINGS = Object.freeze({ anonymousMode: true, defaultBuyAmount: 10000, defaultBuyReason: "符合策略，按计划买入", defaultSellReturnPct: 10, includeBeijingExchange: false, includeStarMarket: false });

function loadSettings() {
  try {
    const stored = JSON.parse(window.localStorage.getItem("simulator.settings") ?? "{}");
    const defaultBuyAmount = Number(stored.defaultBuyAmount);
    const defaultSellReturnPct = Number(stored.defaultSellReturnPct);
    return {
      anonymousMode: typeof stored.anonymousMode === "boolean" ? stored.anonymousMode : DEFAULT_SETTINGS.anonymousMode,
      defaultBuyAmount: Number.isFinite(defaultBuyAmount) && defaultBuyAmount > 0 ? defaultBuyAmount : DEFAULT_SETTINGS.defaultBuyAmount,
      defaultBuyReason: typeof stored.defaultBuyReason === "string" ? stored.defaultBuyReason : DEFAULT_SETTINGS.defaultBuyReason,
      defaultSellReturnPct: Number.isFinite(defaultSellReturnPct) && defaultSellReturnPct >= 0 ? defaultSellReturnPct : DEFAULT_SETTINGS.defaultSellReturnPct,
      includeBeijingExchange: typeof stored.includeBeijingExchange === "boolean" ? stored.includeBeijingExchange : DEFAULT_SETTINGS.includeBeijingExchange,
      includeStarMarket: typeof stored.includeStarMarket === "boolean" ? stored.includeStarMarket : DEFAULT_SETTINGS.includeStarMarket,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function SessionProvider({ children, client = api }) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [settings, setSettings] = useState(loadSettings);
  const activeRuns = useRef(0);

  useEffect(() => {
    const sessionId = window.localStorage.getItem("simulator.accountId") ?? window.localStorage.getItem("simulator.sessionId");
    if (!sessionId || !client.getAccount) return;
    client.getAccount(sessionId).then(setSession).catch(() => window.localStorage.removeItem("simulator.accountId"));
  }, [client]);

  useEffect(() => {
    if (session?.id) window.localStorage.setItem("simulator.accountId", session.id);
  }, [session?.id]);

  useEffect(() => {
    window.localStorage.setItem("simulator.settings", JSON.stringify(settings));
  }, [settings]);

  const run = useCallback(async (action) => {
    activeRuns.current += 1;
    if (activeRuns.current === 1) setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.id && result?.version) setSession(result);
      return result;
    } catch (caught) {
      setError(caught);
      throw caught;
    } finally {
      activeRuns.current = Math.max(0, activeRuns.current - 1);
      if (activeRuns.current === 0) setBusy(false);
    }
  }, []);

  const value = useMemo(() => ({
    busy,
    client,
    error,
    run,
    session,
    sessionId: session?.id ?? null,
    selectedCandidate,
    settings,
    setSelectedCandidate,
    setError,
    setSettings,
    setSession,
    version: session?.version ?? null,
  }), [busy, client, error, selectedCandidate, session, settings]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

export { DEFAULT_SETTINGS };
