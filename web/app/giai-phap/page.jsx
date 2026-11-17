import Link from "next/link";
import { CORE_SEO_KEYWORDS, SITE_URL, guideBase, guides } from "../../src/lib/seo-guides";
import { PublicFooter } from "../../src/components/public-footer";

export const metadata = {
  title: "Giải pháp Vietsub AI, dịch video, OCR & lồng tiếng tự động",
  description: "Khám phá trọn bộ hướng dẫn Vietsub AI, dịch video Trung–Việt/Anh/Nhật/Hàn, tách phụ đề cứng OCR, che chữ gốc, thuyết minh 31 giọng đọc, Bilibili, Douyin và YouTube Shorts.",
  keywords: CORE_SEO_KEYWORDS,
  alternates: { canonical: guideBase },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Giải pháp Vietsub AI, dịch video & lồng tiếng | ReupAI",
    description: "Hướng dẫn từng bước cho mọi nhu cầu dịch video, làm phụ đề SRT và thuyết minh AI với ReupAI Local Engine.",
    url: `${SITE_URL}${guideBase}`,
    type: "website",
    locale: "vi_VN",
    siteName: "ReupAI",
    images: ["/images/reupai-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Giải pháp Vietsub AI & lồng tiếng video | ReupAI",
    description: "Trọn bộ hướng dẫn dịch video, tách phụ đề OCR, Bilibili, Douyin và YouTube Shorts với ReupAI.",
    images: ["/images/reupai-og.png"],
  },
};

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Giải pháp Vietsub AI, dịch video & lồng tiếng | ReupAI",
    url: `${SITE_URL}${guideBase}`,
    inLanguage: "vi-VN",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: guides.map((guide, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_URL}${guideBase}/${guide.slug}`,
        name: guide.title,
      })),
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Giải pháp", item: `${SITE_URL}${guideBase}` },
    ],
  },
];

export default function GuidesPage() {
  return <main className="seo-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <header className="seo-nav"><Link href="/" className="seo-brand">Reup<span>AI</span></Link><nav aria-label="Điều hướng"><Link href="/local-engine">Local Engine</Link><Link href="/plans">Gói dịch vụ</Link><Link href="/sign-in">Đăng nhập</Link></nav></header>
    <div className="seo-container">
      <p className="seo-eyebrow">HƯỚNG DẪN REUPAI</p>
      <h1>Giải pháp Vietsub AI, dịch video &amp; lồng tiếng cho từng nhu cầu</h1>
      <p className="seo-lede">Tìm cách làm Vietsub Trung–Việt, tách phụ đề cứng bằng OCR, che phụ đề gốc, tạo file SRT và thuyết minh 31 giọng đọc tiếng Việt bằng ReupAI Local Engine.</p>
      <div className="seo-guide-grid">{guides.map((guide) => <article className="seo-guide-card" key={guide.slug}>
        <span>{guide.category}</span><h2><Link href={`${guideBase}/${guide.slug}`}>{guide.title}</Link></h2><p>{guide.description}</p><Link className="seo-card-link" href={`${guideBase}/${guide.slug}`}>Xem hướng dẫn <span aria-hidden="true">→</span></Link>
      </article>)}</div>
      <section className="seo-callout"><div><h2>Bắt đầu với video của bạn</h2><p>Chọn nguồn, xem trước thiết lập rồi để Local Engine xử lý ngay trên máy Windows.</p></div><Link href="/sign-up">Tạo tài khoản →</Link></section>
    </div>
    <PublicFooter />
  </main>;
}
