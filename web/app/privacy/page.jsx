import { LegalPage } from "../../src/components/legal-page";

export const metadata = {
  title: "Chính sách riêng tư",
  description: "Tìm hiểu ReupAI sử dụng thông tin tài khoản, xử lý video trên máy và kết nối Google Gemini như thế nào.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Chính sách riêng tư | ReupAI",
    description: "Tìm hiểu ReupAI sử dụng thông tin tài khoản, xử lý video trên máy và kết nối Google Gemini như thế nào.",
    url: "https://www.reupai.cloud/privacy",
    type: "website", locale: "vi_VN", siteName: "ReupAI",
    images: [{ url: "/images/reupai-og.png", width: 1200, height: 630, alt: "ReupAI" }],
  },
};

export default function PrivacyPage() { return <LegalPage type="privacy" />; }
