import { PlansPage } from "../../src/components/plans-page";
import { CORE_SEO_KEYWORDS, SITE_URL } from "../../src/lib/seo-guides";

const description = "Xem bảng giá ReupAI Free (miễn phí 3 video hoàn tất) và gói ReupAI Pro: mở khóa Vietsub AI, dịch video Trung–Việt, OCR phụ đề và 31 giọng đọc AI không giới hạn lượt.";

export const metadata = {
  title: "Bảng giá ReupAI Free và Pro | Gói dịch video & Vietsub AI",
  description,
  keywords: [...CORE_SEO_KEYWORDS, "bảng giá ReupAI", "gói ReupAI Pro", "dùng thử Vietsub AI miễn phí"],
  alternates: { canonical: "/plans" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Bảng giá ReupAI Free và Pro | ReupAI",
    description,
    url: `${SITE_URL}/plans`,
    type: "website",
    locale: "vi_VN",
    siteName: "ReupAI",
    images: ["/images/reupai-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bảng giá ReupAI Free và Pro",
    description,
    images: ["/images/reupai-og.png"],
  },
};

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Bảng giá ReupAI Free và Pro",
    description,
    url: `${SITE_URL}/plans`,
    inLanguage: "vi-VN",
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Bảng giá", item: `${SITE_URL}/plans` },
    ],
  },
];

export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <PlansPage />
  </>;
}
