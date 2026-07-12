import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "./state/SessionContext.jsx";
import CreateSessionPage from "./pages/CreateSessionPage.jsx";
import CandidatesPage from "./pages/CandidatesPage.jsx";
import TradePage from "./pages/TradePage.jsx";
import ReviewPage from "./pages/ReviewPage.jsx";

function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="brand" to="/create">历史交易练习</NavLink>
        <nav aria-label="主导航">
          <NavLink to="/create">创建</NavLink>
          <NavLink to="/candidates">候选池</NavLink>
          <NavLink to="/trade">交易</NavLink>
          <NavLink to="/review">复盘</NavLink>
        </nav>
      </header>
      <main className="page-shell">
        <Routes>
          <Route element={<CreateSessionPage />} path="/create" />
          <Route element={<CandidatesPage />} path="/candidates" />
          <Route element={<TradePage />} path="/trade" />
          <Route element={<ReviewPage />} path="/review" />
          <Route element={<Navigate replace to="/create" />} path="*" />
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
