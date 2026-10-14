import "./globals.css";
import { SiteFrame } from "../src/components/site-frame";

export const metadata = { title: "ReupAI" };

export default function RootLayout({ children }) {
  return <html lang="vi"><body className="theme-xports"><SiteFrame>{children}</SiteFrame></body></html>;
}
