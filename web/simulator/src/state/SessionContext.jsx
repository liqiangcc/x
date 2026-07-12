import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { api } from "../api/client.js";

const SessionContext = createContext(null);

export function SessionProvider({ children, client = api }) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  const run = useCallback(async (action) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.id && result?.version) setSession(result);
      return result;
    } catch (caught) {
      setError(caught);
      throw caught;
    } finally {
      setBusy(false);
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
    setSelectedCandidate,
    setError,
    setSession,
    version: session?.version ?? null,
  }), [busy, client, error, selectedCandidate, session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
