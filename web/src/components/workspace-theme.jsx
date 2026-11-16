"use client";

import { createContext, useContext, useEffect, useState } from "react";

const THEME_KEY = "reupai:theme";
const ThemeContext = createContext(null);

function isTheme(value) {
  return value === "light" || value === "dark";
}

export function WorkspaceTheme({ children }) {
  const [theme, setTheme] = useState("dark");

  function applyTheme(next) {
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }

  function saveTheme(next) {
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const defaultTheme = isLocal ? "light" : "dark";
    const previewTheme = isLocal ? url.searchParams.get("theme") : null;

    if (isTheme(previewTheme)) {
      saveTheme(previewTheme);
      url.searchParams.delete("theme");
      window.history.replaceState(window.history.state, "", url);
    } else {
      let saved;
      try { saved = localStorage.getItem(THEME_KEY); } catch {}
      applyTheme(isTheme(saved) ? saved : defaultTheme);
    }

    const syncTheme = (event) => {
      if (event.key === THEME_KEY || event.key === null) {
        applyTheme(isTheme(event.newValue) ? event.newValue : defaultTheme);
      }
    };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme: () => saveTheme(theme === "light" ? "dark" : "light") }}>
    {children}
  </ThemeContext.Provider>;
}

export function useWorkspaceTheme() {
  return useContext(ThemeContext);
}
