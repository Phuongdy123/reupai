"use client";

import { AppShell } from "./app-shell";
import { EngineProvider, EngineGuestProvider } from "./engine-provider";
import { BillingGuestProvider } from "./billing-provider";
import { GuestAccessProvider } from "./guest-access";

export function WorkspaceHome({ guest, children }) {
  if (guest) return <GuestAccessProvider><BillingGuestProvider><EngineGuestProvider><AppShell>{children}</AppShell></EngineGuestProvider></BillingGuestProvider></GuestAccessProvider>;
  return <EngineProvider><AppShell>{children}</AppShell></EngineProvider>;
}
