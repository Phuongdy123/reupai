import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_URL, getGuide, guideBase, guides } from "../../../src/lib/seo-guides";
import { PublicFooter } from "../../../src/components/public-footer";

export function generateStaticParams() {
  return guides.map(({ slug }) => ({ slug }));
}

export function generateMetadata({ params }) {
  const guide = getGuide(params.slug);
  if (!guide) return {};
  const url = `${guideBase}/${guide.slug}`;
  return {
    title: guide.title,
    description: guide.description,
    keywords: guide.keywords,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { title: guide.title, description: guide.description, url: `${SITE_URL}${url}`, type: "article", locale: "vi_VN", siteName: "ReupAI", images: ["/images/reupai-og.png"] },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description, images: ["/images/reupai-og.png"] },
  };
}

export default function GuidePage({ params }) {
  const guide = getGuide(params.slug);
  if (!guide) notFound();
  const url = `${SITE_URL}${guideBase}/${guide.slug}`;
  const structuredData = [
    { "@context": "https://schema.org", "@type": "WebPage", name: guide.title, description: guide.description, keywords: guide.keywords?.join(", "), url, inLanguage: "vi-VN", isPartOf: { "@type": "WebSite", name: "ReupAI", url: SITE_URL } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Giải pháp", item: `${SITE_URL}${guideBase}` },
      { "@type": "ListItem", position: 3, name: guide.title, item: url },
    ] },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: guide.title,
      description: guide.description,
      inLanguage: "vi-VN",
      step: guide.steps.map(([name, text], index) => ({
        "@type": "HowToStep",
        position: index + 1,
        name,
        text,
      })),
    },
    ...(guide.faq?.length
      ? [{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: guide.faq.map(([name, text]) => ({
            "@type": "Question",
            name,
            acceptedAnswer: { "@type": "Answer", text },
          })),
        }]
      : []),
  ];
  return <main className="seo-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <header className="seo-nav"><Link href="/" className="seo-brand">Reup<span>AI</span></Link><nav aria-label="Điều hướng"><Link href={guideBase}>Giải pháp</Link><Link href="/local-engine">Local Engine</Link><Link href="/plans">Gói dịch vụ</Link><Link href="/sign-in">Đăng nhập</Link></nav></header>
    <div className="seo-container">
      <nav className="seo-breadcrumb" aria-label="Đường dẫn"><Link href="/">Trang chủ</Link><span>/</span><Link href={guideBase}>Giải pháp</Link><span>/</span><span>{guide.title}</span></nav>
      <p className="seo-eyebrow">{guide.category}</p><h1>{guide.title}</h1><p className="seo-lede">{guide.intro}</p>
      <div className="seo-two-column"><article className="seo-main-content">
        <section><h2>Khi nào nên dùng?</h2><ul>{guide.useCases.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section><h2>Cách thực hiện trong ReupAI</h2><ol className="seo-steps">{guide.steps.map(([title, detail]) => <li key={title}><strong>{title}</strong><p>{detail}</p></li>)}</ol></section>
        <section className="seo-note"><h2>Điều cần kiểm tra</h2><p>{guide.note}</p></section>
        <section>
          <h2>So sánh: Làm thủ công vs Tự động hóa bằng ReupAI</h2>
          <div style={{ overflowX: "auto", marginTop: "12px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.94rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
                  <th style={{ padding: "10px 12px" }}>Tiêu chí</th>
                  <th style={{ padding: "10px 12px" }}>Làm thủ công</th>
                  <th style={{ padding: "10px 12px" }}>ReupAI Local Engine</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>Tách thoại &amp; Phụ đề</td>
                  <td style={{ padding: "10px 12px" }}>Chép tay hoặc dùng nhiều công cụ rời rạc</td>
                  <td style={{ padding: "10px 12px" }}>Tự động Whisper + PaddleOCR quét chữ cứng</td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>Che chữ gốc &amp; Vietsub</td>
                  <td style={{ padding: "10px 12px" }}>Căn chỉnh từng khung, dễ tràn dòng</td>
                  <td style={{ padding: "10px 12px" }}>Tự làm mờ hardsub, cố định cỡ chữ chuẩn</td>
                </tr>
                <tr>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>Lồng tiếng &amp; Xuất bản</td>
                  <td style={{ padding: "10px 12px" }}>Thu âm/ghép từng đoạn, tải lên thủ công</td>
                  <td style={{ padding: "10px 12px" }}>31 giọng đọc AI + Đăng YouTube/Reels/TikTok</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section><h2>Câu hỏi thường gặp</h2><div className="seo-faq">{guide.faq.map(([question, answer]) => <div key={question}><h3>{question}</h3><p>{answer}</p></div>)}</div></section>
        {guide.keywords?.length ? <section><h2>Chủ đề &amp; từ khóa liên quan</h2><p>{guide.keywords.join(" • ")}</p></section> : null}
      </article><aside className="seo-sidebar"><h2>Bắt đầu xử lý</h2><p>Đăng nhập, chọn video và xem trước cài đặt trước khi tạo job.</p><Link href="/sign-up" className="seo-primary-link">Dùng thử ReupAI →</Link><Link href="/local-engine">Tải Local Engine Windows</Link><Link href="/plans">Xem gói Free và Pro</Link><p className="seo-sidebar-note">Cần cài Local Engine trên Windows để xử lý video.</p></aside></div>
      <section className="seo-related"><h2>Hướng dẫn liên quan</h2><div>{guide.related.map((slug) => { const related = getGuide(slug); return related ? <Link href={`${guideBase}/${slug}`} key={slug}>{related.title}<span aria-hidden="true">→</span></Link> : null; })}</div></section>
    </div>
    <PublicFooter />
  </main>;
}
