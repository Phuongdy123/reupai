"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "./app-shell";
import { EngineProvider } from "./engine-provider";
import { FeedbackProvider } from "./feedback-provider";
import { BillingProvider } from "./billing-provider";
import { ClickBurst } from "./click-burst";
import { GUEST_WORKSPACE_ROUTES } from "../lib/workspace-routes.mjs";

const PUBLIC_ROUTES = new Set(["/", ...GUEST_WORKSPACE_ROUTES, "/sign-in", "/sign-up", "/pending", "/plans", "/terms", "/privacy", "/local-engine"]);

export function SiteFrame({ children }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_ROUTES.has(pathname) || pathname.startsWith("/auth/") || pathname.startsWith("/giai-phap");
  return <BillingProvider><FeedbackProvider><ClickBurst />{isPublic ? children : <EngineProvider><AppShell>{children}</AppShell></EngineProvider>}</FeedbackProvider></BillingProvider>;
}
