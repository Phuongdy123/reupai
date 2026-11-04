import Link from "next/link";
import { guideBase, guides } from "../../src/lib/seo-guides";
import { PublicFooter } from "../../src/components/public-footer";

export const metadata = {
  title: "Giải pháp Vietsub, dịch và lồng tiếng video bằng AI",
  description: "Khám phá hướng dẫn Vietsub AI, dịch video Trung–Việt, tạo phụ đề từ lời nói, lồng tiếng, xử lý video Bilibili và Douyin với ReupAI.",
  alternates: { canonical: guideBase },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Giải pháp Vietsub và lồng tiếng video | ReupAI",
    description: "Hướng dẫn từng bước cho các nhu cầu xử lý video bằng ReupAI Local Engine.",
    url: `https://www.reupai.cloud${guideBase}`,
    type: "website",
    images: ["/images/reupai-og.png"],
  },
};

export default function GuidesPage() {
  return <main className="seo-shell">
    <header className="seo-nav"><Link href="/" className="seo-brand">Reup<span>AI</span></Link><nav aria-label="Điều hướng"><Link href="/plans">Gói dịch vụ</Link><Link href="/sign-in">Đăng nhập</Link></nav></header>
    <div className="seo-container">
      <p className="seo-eyebrow">HƯỚNG DẪN REUPAI</p>
      <h1>Giải pháp cho từng bước xử lý video</h1>
      <p className="seo-lede">Tìm cách tạo Vietsub, dịch lời thoại, lồng tiếng và xử lý phụ đề gốc phù hợp với video của bạn. Mỗi hướng dẫn nêu rõ các bước và trường hợp cần kiểm tra thủ công.</p>
      <div className="seo-guide-grid">{guides.map((guide) => <article className="seo-guide-card" key={guide.slug}>
        <span>{guide.category}</span><h2><Link href={`${guideBase}/${guide.slug}`}>{guide.title}</Link></h2><p>{guide.description}</p><Link className="seo-card-link" href={`${guideBase}/${guide.slug}`}>Xem hướng dẫn <span aria-hidden="true">→</span></Link>
      </article>)}</div>
      <section className="seo-callout"><div><h2>Bắt đầu với video của bạn</h2><p>Chọn nguồn, xem trước thiết lập rồi để Local Engine xử lý trên máy.</p></div><Link href="/sign-up">Tạo tài khoản →</Link></section>
    </div>
    <PublicFooter />
  </main>;
}
