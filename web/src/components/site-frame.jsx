"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "./app-shell";
import { EngineProvider } from "./engine-provider";
import { FeedbackProvider } from "./feedback-provider";
import { BillingProvider } from "./billing-provider";
import { ClickBurst } from "./click-burst";
import { ChunkRecovery } from "./chunk-recovery";
import { SupportChatWidget } from "./support-chat-widget";
import { GUEST_WORKSPACE_ROUTES } from "../lib/workspace-routes.mjs";

const PUBLIC_ROUTES = new Set(["/", ...GUEST_WORKSPACE_ROUTES, "/sign-in", "/sign-up", "/pending", "/plans", "/terms", "/privacy", "/local-engine"]);

export function SiteFrame({ children }) {
  const pathname = usePathname();
  useEffect(() => {
    const applyTheme = () => {
      try {
        const saved = localStorage.getItem("reupai:theme");
        document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
      } catch {
        document.documentElement.dataset.theme = "dark";
      }
    };
    applyTheme();
    window.addEventListener("reupai:theme-change", applyTheme);
    window.addEventListener("storage", applyTheme);
    return () => {
      window.removeEventListener("reupai:theme-change", applyTheme);
      window.removeEventListener("storage", applyTheme);
    };
  }, []);
  const isPublic = PUBLIC_ROUTES.has(pathname) || pathname.startsWith("/auth/") || pathname.startsWith("/giai-phap");
  return <BillingProvider><FeedbackProvider><ChunkRecovery /><ClickBurst />{isPublic ? children : <EngineProvider><AppShell>{children}</AppShell></EngineProvider>}<SupportChatWidget /></FeedbackProvider></BillingProvider>;
}
