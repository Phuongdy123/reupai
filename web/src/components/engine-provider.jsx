"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ConnectionManager } from "../lib/connection-manager";
import { localEngineClient } from "../lib/local-engine-client";

const EngineContext = createContext(null);

export function EngineProvider({ children }) {
  const [connection, setConnection] = useState(localEngineClient.connection);
  const manager = useMemo(
    () => new ConnectionManager(localEngineClient),
    [],
  );

  useEffect(() => {
    let active = true;
    let timer;
    const unsubscribe = localEngineClient.onChange(setConnection);
    window.reupEngineClient = localEngineClient;
    const poll = async () => {
      if (localEngineClient.status !== "authorizing") await manager.check();
      if (active) timer = window.setTimeout(poll, localEngineClient.status === "connected" ? 10000 : 5000);
    };
    const reconnect = () => { if (document.visibilityState === "visible" && localEngineClient.status !== "authorizing") manager.check(); };
    poll();
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => { active = false; unsubscribe(); window.clearTimeout(timer); window.removeEventListener("online", reconnect); document.removeEventListener("visibilitychange", reconnect); manager.destroy(); };
  }, [manager]);

  const value = useMemo(() => ({
    ...connection,
    client: localEngineClient,
    check: () => manager.check(),
    connect: () => manager.authorize(),
    revoke: () => manager.revoke(),
  }), [connection, manager]);

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine() {
  const context = useContext(EngineContext);
  if (!context) throw new Error("useEngine must be used inside EngineProvider");
  return context;
}
