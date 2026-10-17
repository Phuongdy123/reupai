import "./globals.css";
import { SiteFrame } from "../src/components/site-frame";

export const metadata = { title: "ReupAI" };
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return <html lang="vi"><body className="theme-xports"><SiteFrame>{children}</SiteFrame></body></html>;
}
