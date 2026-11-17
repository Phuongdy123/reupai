import "./globals.css";
import { SiteFrame } from "../src/components/site-frame";
import { CORE_SEO_KEYWORDS, SITE_URL } from "../src/lib/seo-guides";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Reup AI (ReupAI) – Vietsub AI, dịch video & lồng tiếng tự động", template: "%s | ReupAI" },
  description: "ReupAI hỗ trợ Vietsub AI, dịch video tiếng Trung/Anh/Nhật/Hàn sang tiếng Việt, tách phụ đề OCR, che chữ gốc, lồng tiếng 31 giọng đọc AI và tải video Bilibili, Douyin ngay trên máy.",
  keywords: CORE_SEO_KEYWORDS,
  applicationName: "ReupAI",
  category: "MultimediaApplication",
  verification: { google: "C-gJu6pTdQb161u6tYq9LcnDALVMlyrsA7Zsi9rwWMc" },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/images/reupai-logo.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/images/reupai-logo.png", sizes: "512x512", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    url: SITE_URL,
    siteName: "ReupAI",
    title: "Reup AI (ReupAI) – Vietsub AI, dịch video & lồng tiếng tự động",
    description: "Dịch video bằng AI, tách phụ đề cứng OCR, tạo Vietsub Trung Việt và thuyết minh 31 giọng đọc tiếng Việt với ReupAI Local Engine.",
    images: [{ url: "/images/reupai-og.png", width: 1200, height: 630, alt: "ReupAI - Công cụ Vietsub và lồng tiếng video bằng AI" }],
  },
  twitter: { card: "summary_large_image", title: "Reup AI (ReupAI) – Vietsub AI & lồng tiếng video", description: "Dịch video, tách phụ đề OCR, tạo Vietsub tiếng Việt và lồng tiếng 31 giọng AI ngay trên máy với ReupAI.", images: ["/images/reupai-og.png"] },
  // App routes are private; each public page opts into indexing below.
  robots: { index: false, follow: false },
};
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return <html lang="vi"><body className="theme-xports"><SiteFrame>{children}</SiteFrame></body></html>;
}
