"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "./app-shell";
import { EngineProvider } from "./engine-provider";

const PUBLIC_ROUTES = new Set(["/", "/sign-in", "/sign-up", "/pending"]);

export function SiteFrame({ children }) {
  const pathname = usePathname();
  if (PUBLIC_ROUTES.has(pathname) || pathname.startsWith("/auth/")) return children;
  return <EngineProvider><AppShell>{children}</AppShell></EngineProvider>;
}
