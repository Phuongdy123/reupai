import Link from "next/link";
import engineRelease from "../../src/lib/engine-release.json";
import { PublicFooter } from "../../src/components/public-footer";
import { SITE_URL } from "../../src/lib/seo-guides";
import { REUPAI_MICROSOFT_STORE_URL } from "../../src/lib/store-links";

const pageDescription =
  "Tải ReupAI Local Engine cho Windows 10/11 (64-bit) trên Microsoft Store để tải video Bilibili/Douyin, chạy Whisper, OCR tách phụ đề cứng, FFmpeg và 31 giọng đọc tiếng Việt AI ngay trên máy.";
const engineVersion = engineRelease?.release?.version || "0.2.55";

export const metadata = {
  title: "Tải ReupAI Local Engine cho Windows | Phần mềm Vietsub & Lồng tiếng AI",
  description: pageDescription,
  keywords: [
    "tải ReupAI",
    "ReupAI Local Engine",
    "tải app Vietsub AI Windows",
    "phần mềm dịch video offline Windows",
    "tải ReupAI Microsoft Store",
  ],
  alternates: { canonical: "/local-engine" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Tải ReupAI Local Engine cho Windows | ReupAI",
    description: pageDescription,
    url: `${SITE_URL}/local-engine`,
    type: "website",
    locale: "vi_VN",
    siteName: "ReupAI",
    images: ["/images/reupai-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tải ReupAI Local Engine cho Windows | ReupAI",
    description: pageDescription,
    images: ["/images/reupai-og.png"],
  },
};

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ReupAI Local Engine",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Windows 10, Windows 11 (x64)",
    softwareVersion: engineVersion,
    description: pageDescription,
    url: `${SITE_URL}/local-engine`,
    downloadUrl: REUPAI_MICROSOFT_STORE_URL,
    offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Tải ReupAI Local Engine", item: `${SITE_URL}/local-engine` },
    ],
  },
];

export default function LocalEnginePage() {
  return <main className="plans-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <header className="plans-nav"><Link href="/" className="plans-brand">Reup<span>AI</span></Link><Link href="/app">Vào workspace →</Link></header>
    <div className="plans-content engine-download-page">
      <p className="plans-eyebrow">ỨNG DỤNG WINDOWS BẮT BUỘC · PHIÊN BẢN {engineVersion}</p>
      <h1>Tải ReupAI Local Engine cho Windows</h1>
      <p className="plans-intro">Website dùng để quản lý nguồn Bilibili/Douyin, Series và hàng chờ. Local Engine mới là phần mềm Windows trực tiếp tải, nhận diện lời nói Whisper, quét OCR và render video ngay trên máy của bạn.</p>
      <div className="engine-reason-grid">
        <article><strong>File nằm trên máy bạn</strong><p>Video nguồn và thành phẩm không bị tải lên máy chủ ReupAI.</p></article>
        <article><strong>Bộ xử lý AI đầy đủ</strong><p>Local Engine tích hợp sẵn FFmpeg, Whisper, PaddleOCR tách phụ đề và 31 giọng đọc AI.</p></article>
        <article><strong>Kết nối Gemini an toàn</strong><p>Phiên Google và project Gemini được lưu mã hóa DPAPI trên chính máy Windows này.</p></article>
        <article><strong>Hỗ trợ video dài &amp; Checkpoint</strong><p>Render phân đoạn an toàn, lưu checkpoint tự động để tiếp tục nếu công việc bị gián đoạn.</p></article>
      </div>
      <section className="engine-download-card">
        <div><small>WINDOWS 10/11 · 64-BIT · MICROSOFT STORE</small><h2>ReupAI Local Engine ({engineVersion})</h2><p>Cài bản đã được Microsoft chứng nhận. Sau khi cài, mở ứng dụng rồi quay lại website và bấm “Kết nối ReupAI”.</p></div>
        <a className="plans-button primary" href={REUPAI_MICROSOFT_STORE_URL} target="_blank" rel="noopener noreferrer">Tải từ Microsoft Store →</a>
      </section>
      <section className="engine-download-card">
        <div><h2>Cập nhật mà không mất thư viện</h2><p>Bản cài từ Microsoft Store nhận cập nhật qua Store. Nếu bạn đang dùng bản cài trực tiếp cũ, hãy dùng chức năng “Cập nhật ngay” trong website để cập nhật đúng kênh đó.</p><p>Đừng gỡ dữ liệu hoặc xóa thư viện để cập nhật. Nếu bản cài cũ báo đang có công việc, hãy chờ hoặc thoát Local Engine ở khay hệ thống rồi thử lại.</p></div>
      </section>
      <p className="plans-footnote">Yêu cầu Windows 10/11 64-bit và khoảng 1,5 GB dung lượng trống. Xem thêm <Link href="/giai-phap/xu-ly-video-tren-may">hướng dẫn sử dụng Local Engine</Link> hoặc <Link href="/giai-phap">tất cả giải pháp Vietsub AI</Link>.</p>
    </div>
    <PublicFooter />
  </main>;
}
