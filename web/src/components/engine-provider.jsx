"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ConnectionManager } from "../lib/connection-manager";
import { localEngineClient } from "../lib/local-engine-client";

const EngineContext = createContext(null);

const guestConnection = {
  guest: true, preview: true, status: "disconnected", client: { baseUrl: "", hasPersistentGrant: false },
  check: async () => {}, connect: async () => {}, revoke: async () => {},
};

export function EngineGuestProvider({ children }) {
  return <EngineContext.Provider value={guestConnection}>{children}</EngineContext.Provider>;
}

export function EngineProvider({ children }) {
  const [connection, setConnection] = useState(localEngineClient.connection);
  const manager = useMemo(
    () => new ConnectionManager(localEngineClient),
    [],
  );

  useEffect(() => {
    let active = true;
    let timer;
    let lastWakeAt = 0;
    const unsubscribe = localEngineClient.onChange(setConnection);
    window.reupEngineClient = localEngineClient;
    const scheduleNext = () => {
      window.clearTimeout(timer);
      if (!active || document.visibilityState !== "visible") return;
      timer = window.setTimeout(poll, localEngineClient.status === "connected" ? 15000 : 6000);
    };
    const poll = async ({ silent = true } = {}) => {
      if (!active) return;
      if (document.visibilityState === "visible" && localEngineClient.status !== "authorizing") {
        await localEngineClient.check({ silent });
      }
      scheduleNext();
    };
    const reconnect = () => {
      if (document.visibilityState !== "visible" || localEngineClient.status === "authorizing") return;
      const now = Date.now();
      if (now - lastWakeAt < 2500) return;
      lastWakeAt = now;
      window.clearTimeout(timer);
      void poll({ silent: true });
    };
    if (localEngineClient.status === "connected") {
      scheduleNext();
    } else {
      void poll({ silent: false });
    }
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => { active = false; unsubscribe(); window.clearTimeout(timer); window.removeEventListener("online", reconnect); window.removeEventListener("focus", reconnect); document.removeEventListener("visibilitychange", reconnect); manager.destroy(); };
  }, [manager]);

  const check = useCallback(() => manager.check(), [manager]);
  const connect = useCallback(() => manager.authorize(), [manager]);
  const revoke = useCallback(() => manager.revoke(), [manager]);

  const value = useMemo(() => ({
    ...connection,
    client: localEngineClient,
    check,
    connect,
    revoke,
  }), [connection, check, connect, revoke]);

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine() {
  const context = useContext(EngineContext);
  if (!context) throw new Error("useEngine must be used inside EngineProvider");
  return context;
}
