import "./globals.css";
import { SiteFrame } from "../src/components/site-frame";

export const metadata = {
  metadataBase: new URL("https://www.reupai.cloud"),
  title: { default: "Reup AI (ReupAI) – Vietsub AI & lồng tiếng video", template: "%s | ReupAI" },
  description: "ReupAI hỗ trợ dịch video bằng AI, tạo phụ đề tiếng Việt, Vietsub Trung Việt, lồng tiếng AI, chuyển giọng nói thành văn bản và quản lý video ngay trên máy.",
  keywords: ["Reup AI", "ReupAI", "Reup AI Vietsub", "Vietsub AI", "dịch video bằng AI", "dịch video sang tiếng Việt", "dịch phụ đề", "dịch phụ đề video", "phụ đề Việt Trung", "phụ đề song ngữ", "Vietsub Trung Việt", "lồng tiếng AI", "lồng tiếng video", "đọc văn bản tiếng Việt", "chuyển văn bản thành giọng nói", "chuyển giọng nói thành văn bản", "tải video Bilibili", "tải video Douyin", "ReupAI Local Engine"],
  applicationName: "ReupAI",
  verification: { google: "C-gJu6pTdQb161u6tYq9LcnDALVMlyrsA7Zsi9rwWMc" },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/images/reupai-logo.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/images/reupai-logo.png", sizes: "512x512", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: "ReupAI",
    title: "Reup AI (ReupAI) – Vietsub AI & lồng tiếng video",
    description: "Dịch video, tạo phụ đề tiếng Việt và lồng tiếng AI với ReupAI Local Engine.",
    images: [{ url: "/images/reupai-og.png", width: 1200, height: 630, alt: "ReupAI - Công cụ Vietsub và lồng tiếng video bằng AI" }],
  },
  twitter: { card: "summary_large_image", title: "Reup AI (ReupAI) – Vietsub AI & lồng tiếng video", description: "Dịch video, tạo phụ đề tiếng Việt và lồng tiếng AI với ReupAI.", images: ["/images/reupai-og.png"] },
  // App routes are private; each public page opts into indexing below.
  robots: { index: false, follow: false },
};
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return <html lang="vi"><body className="theme-xports"><SiteFrame>{children}</SiteFrame></body></html>;
}
