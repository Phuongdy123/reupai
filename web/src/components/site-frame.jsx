"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "./app-shell";
import { EngineProvider } from "./engine-provider";
import { FeedbackProvider } from "./feedback-provider";
import { BillingProvider } from "./billing-provider";

const PUBLIC_ROUTES = new Set(["/", "/sign-in", "/sign-up", "/pending", "/plans", "/terms", "/privacy"]);

export function SiteFrame({ children }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_ROUTES.has(pathname) || pathname.startsWith("/auth/") || pathname.startsWith("/giai-phap");
  return <BillingProvider><FeedbackProvider>{isPublic ? children : <EngineProvider><AppShell>{children}</AppShell></EngineProvider>}</FeedbackProvider></BillingProvider>;
}
