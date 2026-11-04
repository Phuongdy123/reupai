import Link from "next/link";
import { notFound } from "next/navigation";
import { getGuide, guideBase, guides } from "../../../src/lib/seo-guides";
import { PublicFooter } from "../../../src/components/public-footer";

const siteUrl = "https://www.reupai.cloud";

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
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { title: guide.title, description: guide.description, url: `${siteUrl}${url}`, type: "article", locale: "vi_VN", siteName: "ReupAI", images: ["/images/reupai-og.png"] },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description, images: ["/images/reupai-og.png"] },
  };
}

export default function GuidePage({ params }) {
  const guide = getGuide(params.slug);
  if (!guide) notFound();
  const url = `${siteUrl}${guideBase}/${guide.slug}`;
  const structuredData = [
    { "@context": "https://schema.org", "@type": "WebPage", name: guide.title, description: guide.description, url, inLanguage: "vi-VN", isPartOf: { "@type": "WebSite", name: "ReupAI", url: siteUrl } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Giải pháp", item: `${siteUrl}${guideBase}` },
      { "@type": "ListItem", position: 3, name: guide.title, item: url },
    ] },
  ];
  return <main className="seo-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <header className="seo-nav"><Link href="/" className="seo-brand">Reup<span>AI</span></Link><nav aria-label="Điều hướng"><Link href={guideBase}>Giải pháp</Link><Link href="/plans">Gói dịch vụ</Link><Link href="/sign-in">Đăng nhập</Link></nav></header>
    <div className="seo-container">
      <nav className="seo-breadcrumb" aria-label="Đường dẫn"><Link href="/">Trang chủ</Link><span>/</span><Link href={guideBase}>Giải pháp</Link><span>/</span><span>{guide.title}</span></nav>
      <p className="seo-eyebrow">{guide.category}</p><h1>{guide.title}</h1><p className="seo-lede">{guide.intro}</p>
      <div className="seo-two-column"><article className="seo-main-content">
        <section><h2>Khi nào nên dùng?</h2><ul>{guide.useCases.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section><h2>Cách thực hiện trong ReupAI</h2><ol className="seo-steps">{guide.steps.map(([title, detail]) => <li key={title}><strong>{title}</strong><p>{detail}</p></li>)}</ol></section>
        <section className="seo-note"><h2>Điều cần kiểm tra</h2><p>{guide.note}</p></section>
        <section><h2>Câu hỏi thường gặp</h2><div className="seo-faq">{guide.faq.map(([question, answer]) => <div key={question}><h3>{question}</h3><p>{answer}</p></div>)}</div></section>
      </article><aside className="seo-sidebar"><h2>Bắt đầu xử lý</h2><p>Đăng nhập, chọn video và xem trước cài đặt trước khi tạo job.</p><Link href="/sign-up" className="seo-primary-link">Dùng thử ReupAI →</Link><Link href="/plans">Xem gói Free và Pro</Link><p className="seo-sidebar-note">Cần cài Local Engine trên Windows để xử lý video.</p></aside></div>
      <section className="seo-related"><h2>Hướng dẫn liên quan</h2><div>{guide.related.map((slug) => { const related = getGuide(slug); return related ? <Link href={`${guideBase}/${slug}`} key={slug}>{related.title}<span aria-hidden="true">→</span></Link> : null; })}</div></section>
    </div>
    <PublicFooter />
  </main>;
}
