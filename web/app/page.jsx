import { LandingPage } from "../src/components/landing-page";

const siteUrl = "https://www.reupai.cloud";
const description = "ReupAI là công cụ Vietsub AI giúp dịch video, tạo phụ đề tiếng Việt hoặc song ngữ và lồng tiếng AI. Tải video từ nguồn được hỗ trợ, xử lý bằng Local Engine ngay trên máy của bạn.";

export const metadata = {
  title: { absolute: "Reup AI (ReupAI) – Công cụ Vietsub AI và lồng tiếng video" },
  description,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Reup AI (ReupAI) – Công cụ Vietsub AI và lồng tiếng video",
    description,
    url: siteUrl,
    type: "website",
    locale: "vi_VN",
    siteName: "ReupAI",
    images: [{ url: "/images/reupai-og.png", width: 1200, height: 630, alt: "ReupAI - Vietsub và lồng tiếng video bằng AI" }],
  },
  twitter: { title: "Reup AI (ReupAI) – Công cụ Vietsub AI và lồng tiếng video", description, images: ["/images/reupai-og.png"] },
};

const structuredData = [
  { "@context": "https://schema.org", "@type": "Organization", name: "ReupAI", url: siteUrl, logo: `${siteUrl}/images/reupai-logo.png` },
  { "@context": "https://schema.org", "@type": "WebSite", name: "ReupAI", url: siteUrl, inLanguage: "vi-VN", description },
];

export default function Home() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <LandingPage />
  </>;
}
