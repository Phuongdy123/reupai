import engineRelease from "../src/lib/engine-release.json";
import { CORE_SEO_KEYWORDS, HOME_FAQS, SITE_URL } from "../src/lib/seo-guides";
import { REUPAI_MICROSOFT_STORE_URL } from "../src/lib/store-links";
import { LandingPage } from "../src/components/landing-page";

const description =
  "ReupAI (Reup AI) là công cụ Vietsub AI giúp dịch video tiếng Trung, Anh, Nhật, Hàn sang tiếng Việt, tách phụ đề OCR, che chữ gốc và lồng tiếng 31 giọng AI ngay trên máy bằng Local Engine.";
const engineVersion = engineRelease?.release?.version || "0.2.55";

export const metadata = {
  title: { absolute: "Reup AI (ReupAI) – Công cụ Vietsub AI, dịch video & lồng tiếng tự động" },
  description,
  keywords: CORE_SEO_KEYWORDS,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Reup AI (ReupAI) – Công cụ Vietsub AI, dịch video & lồng tiếng tự động",
    description,
    url: SITE_URL,
    type: "website",
    locale: "vi_VN",
    siteName: "ReupAI",
    images: [{ url: "/images/reupai-og.png", width: 1200, height: 630, alt: "ReupAI - Vietsub và lồng tiếng video bằng AI" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reup AI (ReupAI) – Vietsub AI, dịch video & lồng tiếng tự động",
    description,
    images: ["/images/reupai-og.png"],
  },
};

const structuredData = [
  { "@context": "https://schema.org", "@type": "Organization", name: "ReupAI", url: SITE_URL, logo: `${SITE_URL}/images/reupai-logo.png`, sameAs: [REUPAI_MICROSOFT_STORE_URL] },
  { "@context": "https://schema.org", "@type": "WebSite", name: "ReupAI", alternateName: ["Reup AI", "ReupAI Local Engine"], url: SITE_URL, inLanguage: "vi-VN", description },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ReupAI Local Engine",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Windows 10, Windows 11",
    softwareVersion: engineVersion,
    url: `${SITE_URL}/local-engine`,
    downloadUrl: REUPAI_MICROSOFT_STORE_URL,
    featureList: "Vietsub AI, Dịch video Trung Việt, Whisper tách lời nói thành SRT, PaddleOCR tách phụ đề cứng, Che phụ đề gốc, Lồng tiếng 31 giọng đọc tiếng Việt, Tải nguồn Bilibili/Douyin, Đăng YouTube/Facebook/TikTok",
    offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOME_FAQS.map(([name, text]) => ({
      "@type": "Question",
      name,
      acceptedAnswer: { "@type": "Answer", text },
    })),
  },
];

export default function Home() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <LandingPage />
  </>;
}
