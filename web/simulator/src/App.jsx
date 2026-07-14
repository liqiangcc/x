import { useRef } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SessionProvider } from "./state/SessionContext.jsx";
import CreateSessionPage from "./pages/CreateSessionPage.jsx";
import CandidatesPage from "./pages/CandidatesPage.jsx";
import TradePage from "./pages/TradePage.jsx";
import ReviewPage from "./pages/ReviewPage.jsx";
import WatchlistPage from "./pages/WatchlistPage.jsx";
import StrategiesPage from "./pages/StrategiesPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import DataPage from "./pages/DataPage.jsx";
import { useSession } from "./state/SessionContext.jsx";
import { accountLabel, tradingDayLabel } from "./utils/securityDisplay.js";

function Layout() {
  const { busy, client, run, session, setSession, settings } = useSession();
  const location = useLocation();
  const stockDetailMode = location.pathname.includes("/stocks/");
  const advancing = useRef(false);
  async function advance() {
    if (advancing.current) return;
    advancing.current = true;
    try {
      const next = await run(() => client.advanceAccount(session.id, session.version));
      setSession(next);
    } finally {
      advancing.current = false;
    }
  }
  return (
    <div className="app-shell">
      <header className={`app-header ${stockDetailMode ? "detail-mode" : ""}`}>
        <NavLink className="brand" to="/accounts/new">历史交易练习</NavLink>
        <nav aria-label="主导航">
          <NavLink to="/accounts/new">账号</NavLink>
          <NavLink to="/strategies">策略</NavLink>
          <NavLink to="/candidates">候选池{session?.candidateCount !== null && session?.candidateCount !== undefined && <small className="nav-count">{session.candidateCount}</small>}</NavLink>
          <NavLink to="/watchlist">自选</NavLink>
          <NavLink to="/review">复盘</NavLink>
          <NavLink to="/settings">设置</NavLink>
          <NavLink to="/data">数据</NavLink>
        </nav>
        {session && location.pathname !== "/watchlist" && <div className="global-clock"><strong>{accountLabel(session, settings.anonymousMode)}</strong><span>{tradingDayLabel({ anonymousMode: settings.anonymousMode, date: session.clock.currentDate, dayIndex: session.dayIndex ?? 1 })}</span><button className="primary-button" disabled={busy || !session.clock.nextDate} onClick={advance}>{busy ? "推进中…" : "下一交易日"}</button></div>}
      </header>
      <main className="page-shell">
        <Routes>
          <Route element={<CreateSessionPage />} path="/accounts/new" />
          <Route element={<StrategiesPage />} path="/strategies" />
          <Route element={<CandidatesPage />} path="/candidates" />
          <Route element={<WatchlistPage />} path="/watchlist" />
          <Route element={<TradePage />} path="/accounts/:accountId/stocks/:candidateId" />
          <Route element={<Navigate replace to="/watchlist" />} path="/trade" />
          <Route element={<ReviewPage />} path="/review" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<DataPage />} path="/data" />
          <Route element={<Navigate replace to="/accounts/new" />} path="*" />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Layout />
    </SessionProvider>
  );
}
