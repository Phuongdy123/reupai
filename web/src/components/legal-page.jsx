import Link from "next/link";

const content = {
  privacy: {
    eyebrow: "QUYỀN RIÊNG TƯ",
    title: "Chính sách riêng tư",
    updated: "Cập nhật lần cuối: 21/10/2026",
    sections: [
      ["Dữ liệu chúng tôi dùng", "ReupAI dùng thông tin tài khoản như email và tên hiển thị để xác thực, cấp quyền sử dụng và hỗ trợ người dùng."],
      ["Video và tệp", "Video, âm thanh và dự án được Local Engine xử lý trên máy của bạn. ReupAI không tự động tải nội dung nguồn hoặc thành phẩm từ Local Engine lên máy chủ của ReupAI."],
      ["Đăng nhập Google", "Khi bạn chọn đăng nhập bằng Google, ReupAI chỉ nhận thông tin hồ sơ cơ bản cần thiết để tạo phiên đăng nhập. Việc cấp quyền luôn diễn ra trên trang xác thực của Google."],
      ["Liên hệ", "Nếu có câu hỏi về quyền riêng tư, hãy liên hệ phuongndps39487@gmail.com."],
    ],
  },
  terms: {
    eyebrow: "ĐIỀU KHOẢN SỬ DỤNG",
    title: "Điều khoản dịch vụ",
    updated: "Cập nhật lần cuối: 21/10/2026",
    sections: [
      ["Phạm vi dịch vụ", "ReupAI là không gian làm việc hỗ trợ quản lý và xử lý video thông qua Local Engine trên thiết bị của người dùng."],
      ["Tài khoản", "Bạn chịu trách nhiệm bảo mật tài khoản của mình và sử dụng dịch vụ phù hợp với pháp luật cũng như quyền sở hữu nội dung."],
      ["Nội dung", "Bạn cần có quyền hợp pháp đối với video, âm thanh và tài nguyên đưa vào ReupAI. Bạn tự chịu trách nhiệm về nội dung đã xử lý hoặc xuất bản."],
      ["Thay đổi dịch vụ", "Chúng tôi có thể cập nhật ReupAI để cải thiện độ ổn định, bảo mật và trải nghiệm sử dụng."],
      ["Liên hệ", "Nếu cần hỗ trợ, hãy liên hệ phuongndps39487@gmail.com."],
    ],
  },
};

export function LegalPage({ type }) {
  const page = content[type];
  return <main className="legal-shell">
    <header className="legal-nav"><Link className="landing-brand" href="/"><span>R</span><strong>Reup AI</strong></Link><Link href="/" className="button-secondary">Trang chủ</Link></header>
    <article className="legal-card"><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1><p className="legal-updated">{page.updated}</p>{page.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}</article>
  </main>;
}
