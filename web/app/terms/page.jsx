import { LegalPage } from "../../src/components/legal-page";

export const metadata = {
  title: "Điều khoản dịch vụ",
  description: "Điều khoản sử dụng ReupAI, trách nhiệm về tài khoản, nội dung video và phạm vi dịch vụ.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Điều khoản dịch vụ | ReupAI",
    description: "Điều khoản sử dụng ReupAI, trách nhiệm về tài khoản, nội dung video và phạm vi dịch vụ.",
    url: "https://www.reupai.cloud/terms",
    type: "website", locale: "vi_VN", siteName: "ReupAI",
    images: [{ url: "/images/reupai-og.png", width: 1200, height: 630, alt: "ReupAI" }],
  },
};

export default function TermsPage() { return <LegalPage type="terms" />; }
