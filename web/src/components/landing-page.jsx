import Link from "next/link";
import { Icon } from "./icon";
import { HOME_FAQS, guideBase, guides } from "../lib/seo-guides";
import { PublicFooter } from "./public-footer";
import { PublicStarfield } from "./public-starfield";

const steps = [
  { number: "01", icon: "source", title: "Đồng bộ nguồn Bilibili & Douyin", description: "Thêm link video lẻ hoặc kênh nguồn, lưu thành Series dài tập hoặc Collections và chọn tập xử lý hàng loạt." },
  { number: "02", icon: "spark", title: "Vietsub AI, OCR & Thuyết minh", description: "Nhận diện lời nói Whisper hoặc quét chữ cứng OCR, dịch Trung–Việt, che phụ đề gốc và lồng tiếng 31 giọng AI." },
  { number: "03", icon: "play", title: "Render nhanh & Đăng kênh", description: "Cố định cỡ chữ phụ đề, xuất file SRT hoặc video 16:9 / 9:16 ngay trên máy và đăng lên YouTube, Facebook, TikTok." },
];

export function LandingPage() {
  return <main className="account-shell landing-shell">
    <PublicStarfield />
    <header className="landing-nav">
      <Link href="/" className="landing-brand" aria-label="ReupAI - Trang chủ"><strong>Reup<span>AI</span></strong></Link>
      <nav className="landing-nav-links" aria-label="Giới thiệu"><a href="#tinh-nang">Tính năng</a><a href="#hoi-dap">Hỏi đáp</a><Link href={guideBase}>Giải pháp Vietsub AI</Link><Link href="/local-engine">Tải Local Engine</Link><Link href="/plans">Bảng giá</Link></nav>
      <div className="landing-nav-actions"><Link href="/sign-in" className="button-secondary">Đăng nhập</Link><Link href="/app" className="button-primary">Bắt đầu ngay</Link></div>
    </header>

    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-copy">
        <p className="landing-eyebrow"><span className="landing-kicker-orb" aria-hidden="true" />REUPAI WORKSPACE & LOCAL ENGINE</p>
        <h1 id="landing-title">Vietsub AI, dịch video &amp; lồng tiếng tự động ngay trên máy.</h1>
        <p className="landing-lede">Công cụ làm Vietsub Trung–Việt, dịch phụ đề Anh/Nhật/Hàn, tách phụ đề cứng OCR, che chữ gốc và thuyết minh 31 giọng đọc tiếng Việt cho video Bilibili, Douyin và YouTube Shorts.</p>
        <ul className="landing-highlights" aria-label="Tính năng chính">
          <li><Icon name="download" size={16} /><span>Tải Bilibili &amp; Douyin</span></li>
          <li><Icon name="spark" size={16} /><span>Vietsub AI &amp; OCR</span></li>
          <li><Icon name="play" size={16} /><span>31 Giọng đọc AI</span></li>
        </ul>
        <div className="landing-actions"><Link href="/app" className="button-primary button-large">Bắt đầu ngay</Link><Link href="/local-engine" className="button-secondary button-large">Tải Local Engine</Link></div>
      </div>
      <div className="landing-visual" aria-hidden="true">
        <div className="landing-orbit-art"><span className="landing-orbit-ring ring-one" /><span className="landing-orbit-ring ring-two" /><span className="landing-orbit-sphere" /><span className="landing-orbit-dot dot-one" /><span className="landing-orbit-dot dot-two" /></div>
        <div className="landing-showcase"><div className="landing-showcase-image" /><div className="landing-showcase-vignette" /><div className="landing-showcase-chip"><span className="landing-chip-dot" /> LOCAL ENGINE <strong>Sẵn sàng</strong></div></div>
        <span className="landing-ai-disc"><Icon name="spark" size={22} /><small>AI WORKFLOW</small></span>
      </div>
    </section>

    <section className="landing-feature-section" id="tinh-nang" aria-labelledby="feature-title">
      <div className="landing-section-heading"><p className="eyebrow">QUY TRÌNH XỬ LÝ VIDEO AI</p><h2 id="feature-title">Từ tạo phụ đề SRT đến lồng tiếng và xuất thành phẩm.</h2><p>Chạy trực tiếp qua Windows Local Engine giúp giữ file video tại thiết bị, hỗ trợ GPU/đa luồng CPU và checkpoint video dài hàng giờ.</p></div>
      <div className="landing-feature-grid">{steps.map((step) => <article key={step.number}><span className="landing-feature-number">{step.number}</span><span className="landing-feature-icon"><Icon name={step.icon} size={25} /></span><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
    </section>

    <section className="landing-guides" aria-labelledby="landing-guides-title">
      <div className="landing-guides-heading"><div><p className="eyebrow">CHỌN ĐÚNG CÁCH XỬ LÝ</p><h2 id="landing-guides-title">Bạn muốn làm gì với video?</h2><p>Hướng dẫn chi tiết từ Vietsub video Trung–Việt, thuyết minh AI đến tách phụ đề cứng OCR và xuất SRT.</p></div><Link href={guideBase}>Xem tất cả {guides.length} hướng dẫn →</Link></div>
      <div className="landing-guides-grid">{guides.slice(0, 4).map((guide) => <Link href={`${guideBase}/${guide.slug}`} key={guide.slug}><span>{guide.category}</span><strong>{guide.title}</strong><small>{guide.description}</small><b aria-hidden="true">→</b></Link>)}</div>
    </section>

    <section className="landing-seo-faq" id="hoi-dap" aria-labelledby="landing-faq-title">
      <div className="landing-guides-heading"><div><p className="eyebrow">CÂU HỎI THƯỜNG GẶP VỀ REUPAI</p><h2 id="landing-faq-title">Vietsub AI, OCR &amp; Lồng tiếng trên máy hoạt động thế nào?</h2></div><Link href="/local-engine">Xem yêu cầu Windows &amp; tải ứng dụng →</Link></div>
      <div className="landing-faq-grid">{HOME_FAQS.map(([question, answer]) => <article key={question}><h3>{question}</h3><p>{answer}</p></article>)}</div>
      <div className="landing-topic-pills" aria-label="Chủ đề phổ biến">{guides.slice(4).map((guide) => <Link href={`${guideBase}/${guide.slug}`} key={guide.slug}>{guide.title}</Link>)}</div>
    </section>

    <section className="landing-bottom" id="quy-trinh"><div><p className="eyebrow">SẴN SÀNG BẮT ĐẦU?</p><h2>Đưa ý tưởng video của bạn vào quy trình.</h2><p id="bao-mat">Local Engine xử lý trực tiếp trên máy Windows của bạn. Tặng sẵn 3 video dùng thử miễn phí khi tạo tài khoản.</p></div><Link href="/sign-up" className="button-primary button-large">Tạo tài khoản <span aria-hidden="true">→</span></Link></section>
    <PublicFooter />
  </main>;
}
