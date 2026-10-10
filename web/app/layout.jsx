import "./globals.css";
import { AppShell } from "../src/components/app-shell";
import { EngineProvider } from "../src/components/engine-provider";

export const metadata = { title: "ReupAI" };

export default function RootLayout({ children }) {
  return <html lang="vi"><body className="theme-xports"><EngineProvider><AppShell>{children}</AppShell></EngineProvider></body></html>;
}
