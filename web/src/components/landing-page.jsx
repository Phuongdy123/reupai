import Link from "next/link";
import { Icon } from "./icon";
import { guideBase, guides } from "../lib/seo-guides";
import { PublicFooter } from "./public-footer";

const highlights = [
  { icon: "download", label: "Tự động tải video" },
  { icon: "spark", label: "AI dịch & Vietsub" },
  { icon: "play", label: "Lồng tiếng AI" },
  { icon: "settings", label: "Che mờ nội dung" },
  { icon: "grid", label: "Tùy chỉnh dễ dàng" },
  { icon: "check", label: "Giữ video trên máy" },
];

const steps = [
  { number: "01", icon: "source", title: "Chọn nguồn", description: "Thêm video từ nguồn được hỗ trợ và chọn nội dung bạn muốn xử lý." },
  { number: "02", icon: "spark", title: "Xử lý bằng AI", description: "Tạo Vietsub, lồng tiếng và điều chỉnh các bước xử lý theo video." },
  { number: "03", icon: "play", title: "Nhận thành phẩm", description: "Render và quản lý file thành phẩm ngay trên máy của bạn." },
];

export function LandingPage() {
  return <main className="account-shell landing-shell">
    <header className="landing-nav">
      <Link href="/" className="landing-brand" aria-label="ReupAI - Trang chủ"><strong>Reup<span>AI</span></strong></Link>
      <nav className="landing-nav-links" aria-label="Giới thiệu"><a href="#tinh-nang">Tính năng</a><a href="#quy-trinh">Quy trình</a><Link href={guideBase}>Hướng dẫn</Link><Link href="/plans">Gói dịch vụ</Link></nav>
      <div className="landing-nav-actions"><Link href="/sign-in" className="button-secondary">Đăng nhập</Link><Link href="/sign-up" className="button-primary">Bắt đầu ngay</Link></div>
    </header>

    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-copy">
        <div className="landing-lockup"><strong>Reup<span>AI</span></strong></div>
        <h1 id="landing-title">Từ video nguồn đến thành phẩm, chỉ trong vài bước.</h1>
        <p className="landing-lede">Công cụ tải, Vietsub và lồng tiếng video bằng AI. Sắp xếp nguồn, tùy chỉnh cách xử lý và theo dõi thành phẩm trong một không gian làm việc.</p>
        <ul className="landing-highlights">{highlights.map(({ icon, label }) => <li key={label}><Icon name={icon} size={20} /><span>{label}</span></li>)}</ul>
        <p className="landing-promise">Nhanh hơn <span>•</span> Thông minh hơn <span>•</span> Chủ động hơn</p>
        <div className="landing-actions"><Link href="/sign-up" className="button-primary button-large">Bắt đầu ngay <span aria-hidden="true">→</span></Link><a href="#tinh-nang" className="button-secondary button-large">Tìm hiểu thêm</a></div>
        <p className="landing-local-note"><Icon name="check" size={16} /> Video, dự án và file thành phẩm được giữ trên máy của bạn.</p>
      </div>
      <div className="landing-showcase" aria-hidden="true"><div className="landing-showcase-image" /><div className="landing-showcase-vignette" /><div className="landing-showcase-chip"><span className="landing-chip-dot" /> LOCAL ENGINE <strong>Sẵn sàng</strong></div></div>
    </section>

    <section className="landing-feature-section" id="tinh-nang" aria-labelledby="feature-title">
      <div className="landing-section-heading"><p className="eyebrow">MỘT QUY TRÌNH GỌN GÀNG</p><h2 id="feature-title">Mọi bước xử lý trong một nơi.</h2><p>Từ video mới tải đến bản render cuối cùng, bạn luôn biết công việc đang ở đâu.</p></div>
      <div className="landing-feature-grid">{steps.map((step) => <article key={step.number}><span className="landing-feature-number">{step.number}</span><span className="landing-feature-icon"><Icon name={step.icon} size={25} /></span><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
    </section>

    <section className="landing-guides" aria-labelledby="landing-guides-title">
      <div className="landing-guides-heading"><div><p className="eyebrow">CHỌN ĐÚNG CÁCH XỬ LÝ</p><h2 id="landing-guides-title">Bạn muốn làm gì với video?</h2><p>Hướng dẫn theo từng nhu cầu, từ tạo Vietsub đến xử lý chữ gốc trên khung hình.</p></div><Link href={guideBase}>Xem tất cả hướng dẫn →</Link></div>
      <div className="landing-guides-grid">{guides.slice(0, 4).map((guide) => <Link href={`${guideBase}/${guide.slug}`} key={guide.slug}><span>{guide.category}</span><strong>{guide.title}</strong><small>{guide.description}</small><b aria-hidden="true">→</b></Link>)}</div>
    </section>

    <section className="landing-bottom" id="quy-trinh"><div><p className="eyebrow">SẴN SÀNG BẮT ĐẦU?</p><h2>Đưa ý tưởng video của bạn vào quy trình.</h2><p id="bao-mat">Local Engine xử lý trên thiết bị của bạn. Bạn kiểm soát nguồn, dự án và file xuất.</p></div><Link href="/sign-up" className="button-primary button-large">Tạo tài khoản <span aria-hidden="true">→</span></Link></section>
    <PublicFooter />
  </main>;
}
