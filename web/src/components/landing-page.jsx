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

const comparisonRows = [
  ["Tải nguồn Douyin & Bilibili", "Copy từng link qua web trung gian, dễ lỗi và mất chất lượng", "Đồng bộ cả kênh & Series, tải hàng loạt trực tiếp về ổ cứng"],
  ["Tách lời thoại & Phụ đề cứng", "Nghe chép tay hoặc gõ lại từng câu chữ Trung tốn hàng giờ", "Tự động tách thoại Whisper + quét chữ cứng bằng PaddleOCR"],
  ["Xóa / Che chữ Trung Quốc gốc", "Kẻ khung làm mờ thủ công từng đoạn trên phần mềm dựng", "Tự động nhận diện dải hardsub, làm mờ sạch và đè Vietsub mới"],
  ["Dịch thuật & Căn cỡ chữ SRT", "Copy qua công cụ dịch rời, câu dài bị tràn khung hoặc co chữ nhỏ", "Dịch chuẩn ngữ cảnh AI, cố định cỡ chữ và tự chia trang câu dài"],
  ["Thuyết minh & Lồng tiếng", "Tự thu âm hoặc mua gói TTS tính phí theo từng ký tự", "Tích hợp sẵn 31 giọng đọc AI Bắc/Trung/Nam (25 giọng VieNeu offline miễn phí)"],
  ["Xuất bản & Tạo Thumbnail", "Xuất file rồi mở từng tab YouTube, Facebook, TikTok để đăng", "Vẽ ảnh bìa Thumbnail AI 1280×720, gợi ý tiêu đề SEO & đăng đa kênh"],
];

const voiceShowcase = [
  { region: "Miền Bắc", names: "Trúc Ly, Hải Đăng, Ngọc Huyền, Minh Quân…", style: "Tin tức, Review phim, Giải thích kiến thức chuẩn giọng" },
  { region: "Miền Nam", names: "Phương Thảo, Quốc Bảo, Bảo Ngọc, Gia Huy…", style: "Kể chuyện đời sống, Phim ngắn, Vlog, Giải trí gần gũi" },
  { region: "Miền Trung & Shorts", names: "Thanh Hà, Đình Phong + 6 giọng Edge-TTS", style: "Nhịp nhanh 1.10x – 1.25x cho TikTok, Facebook Reels & YouTube Shorts" },
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
        <p className="landing-eyebrow"><span className="landing-kicker-orb" aria-hidden="true" />PHẦN MỀM REUP VIDEO TỰ ĐỘNG &amp; VIETSUB AI</p>
        <h1 id="landing-title">Reup video tự động, Vietsub AI &amp; lồng tiếng ngay trên máy.</h1>
        <p className="landing-lede">Phần mềm reup video tự động bằng AI: tải nguồn Bilibili &amp; Douyin, dịch phụ đề Trung–Việt/Anh/Nhật/Hàn, tách phụ đề cứng OCR, che chữ gốc và thuyết minh 31 giọng đọc tiếng Việt cho YouTube Shorts, Reels, TikTok.</p>
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

    <section className="landing-guides" id="truoc-sau" aria-labelledby="before-after-title">
      <div className="landing-guides-heading">
        <div>
          <p className="eyebrow">MINH HỌA TRƯỚC &amp; SAU KHI XỬ LÝ</p>
          <h2 id="before-after-title">Biến video ngoại ngữ dính chữ cứng thành bản tiếng Việt hoàn chỉnh.</h2>
          <p>So sánh trực quan giữa video gốc tải từ Douyin/Bilibili và thành phẩm sau khi qua ReupAI Local Engine.</p>
        </div>
        <Link href="/giai-phap/xoa-chu-trung-quoc-che-hardsub-video">Xem cách xóa chữ Trung &amp; che hardsub →</Link>
      </div>
      <div className="landing-faq-grid">
        <article>
          <h3>1. Trước khi xử lý (Video nguồn gốc)</h3>
          <p>• Lời thoại tiếng Trung, Anh, Nhật, Hàn không có sẵn file phụ đề .SRT rời.<br />• Dính dòng chữ phụ đề cứng (hardsub) tiếng nước ngoài đốt thẳng vào khung hình.<br />• Tỷ lệ khung hình và âm lượng chưa đồng bộ với kênh YouTube Shorts, Reels, TikTok của bạn.</p>
        </article>
        <article>
          <h3>2. Sau khi qua ReupAI (Thành phẩm 1-Click)</h3>
          <p>• Tự động nhận diện tọa độ hardsub cũ, phủ lớp làm mờ mềm mại và đặt phụ đề Vietsub cỡ chữ cố định.<br />• Lồng tiếng bằng 1 trong 31 giọng đọc AI tự nhiên, tự động hạ âm gốc (10–20%) và trộn nhạc nền.<br />• Sẵn sàng xuất MP4 16:9 hoặc 9:16 kèm ảnh bìa Thumbnail AI để đăng thẳng lên kênh.</p>
        </article>
      </div>
      <div className="landing-faq-grid" style={{ marginTop: "16px" }}>
        {voiceShowcase.map((v) => (
          <article key={v.region}>
            <h3>🎙️ Hệ giọng đọc {v.region}</h3>
            <p><strong>{v.names}</strong> — {v.style}. Nghe thử trực tiếp trong ứng dụng trước khi bấm render.</p>
          </article>
        ))}
      </div>
    </section>

    <section className="landing-guides" id="so-sanh" aria-labelledby="comparison-title">
      <div className="landing-guides-heading">
        <div>
          <p className="eyebrow">SO SÁNH HIỆU SUẤT SẢN XUẤT</p>
          <h2 id="comparison-title">Làm video Reup thủ công vs Phần mềm Reup video tự động ReupAI</h2>
          <p>Rút ngắn 90% thời gian biên tập lặp đi lặp lại mỗi ngày khi xây dựng hệ thống kênh nội dung.</p>
        </div>
        <Link href="/giai-phap/reup-video-tu-dong-bang-ai">Xem quy trình Reup tự động →</Link>
      </div>
      <div style={{ overflowX: "auto", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(15,19,30,0.65)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.95rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
              <th style={{ padding: "14px 18px" }}>Công đoạn xử lý</th>
              <th style={{ padding: "14px 18px" }}>Cách làm thủ công truyền thống</th>
              <th style={{ padding: "14px 18px" }}>Tự động hóa với ReupAI Local Engine</th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map(([stepName, manualWay, autoWay]) => (
              <tr key={stepName} style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <td style={{ padding: "13px 18px", fontWeight: 600 }}>{stepName}</td>
                <td style={{ padding: "13px 18px", opacity: 0.78 }}>{manualWay}</td>
                <td style={{ padding: "13px 18px" }}><strong>✓ {autoWay}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
