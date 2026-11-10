import Link from "next/link";

const content = {
  privacy: {
    eyebrow: "QUYỀN RIÊNG TƯ",
    title: "Chính sách riêng tư",
    updated: "Cập nhật lần cuối: 27/10/2026",
    sections: [
      ["Dữ liệu chúng tôi dùng", "ReupAI dùng thông tin tài khoản như email và tên hiển thị để xác thực, cấp quyền sử dụng và hỗ trợ người dùng."],
      ["Video và tệp", "Video, âm thanh và dự án được Local Engine xử lý trên máy của bạn. ReupAI không tự động tải nội dung nguồn hoặc thành phẩm từ Local Engine lên máy chủ của ReupAI."],
      ["Đăng nhập Google và Gemini", "Đăng nhập website bằng Google chỉ dùng thông tin nhận dạng cơ bản như email, tên và ảnh hồ sơ để tạo phiên tài khoản ReupAI. Đây là phiên đăng nhập riêng với kết nối Google Gemini trong Local Engine."],
      ["Quyền Google Cloud mà Local Engine sử dụng", "Khi bạn chủ động kết nối Google trong Cài đặt Local Engine, ứng dụng yêu cầu quyền gọi Gemini API (generative-language.retriever) và quyền Google Cloud (cloud-platform) để hỗ trợ tìm project, kiểm tra quyền cần thiết, bật Generative Language API cho project bạn chọn và gửi yêu cầu Gemini theo quota của project đó. Nếu bạn chọn tạo project mới, thao tác tạo chỉ bắt đầu khi bạn bấm nút tạo trong Cài đặt. Mã Local Engine dùng các quyền này cho những thao tác thiết lập Gemini nêu trên; ReupAI không dùng chúng để truy cập Gmail, Drive, Photos hoặc các dịch vụ Google khác."],
      ["Nội dung được gửi đến Google Gemini", "Video nguồn và file thành phẩm được xử lý, lưu trên thiết bị của bạn. Khi bạn chạy tính năng cần Gemini, Local Engine gửi phần nội dung cần thiết để xử lý — chẳng hạn văn bản phụ đề/lời thoại, câu hỏi hoặc ảnh bạn chủ động đính kèm — trực tiếp đến Google Generative Language API. ReupAI không nhận nội dung này qua máy chủ website. Google xử lý nội dung theo điều khoản và chính sách dữ liệu áp dụng cho project/tài khoản Google của bạn; quota và mọi thiết lập thanh toán Google Cloud thuộc project đó."],
      ["Lưu trữ và ngắt kết nối Google", "Token OAuth Gemini và Project ID được lưu cục bộ trên máy Windows; token được mã hóa bằng Windows DPAPI theo tài khoản Windows hiện tại. ReupAI không gửi token Gemini lên máy chủ website. Dùng nút Ngắt kết nối Google trong Cài đặt để xóa token khỏi Local Engine. Thao tác này không xóa project Google Cloud và có thể không thu hồi quyền đã cấp ở phía Google; để thu hồi hẳn, hãy gỡ ReupAI trong phần kết nối ứng dụng bên thứ ba của Tài khoản Google. Dữ liệu trong project, lịch sử Gemini, quota và thời hạn lưu do Google quản lý theo thiết lập của bạn."],
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
    <header className="legal-nav"><Link className="landing-brand" href="/" aria-label="ReupAI - Trang chủ"><strong>Reup<span>AI</span></strong></Link><Link href="/" className="button-secondary">Trang chủ</Link></header>
    <article className="legal-card"><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1><p className="legal-updated">{page.updated}</p>{page.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}</article>
  </main>;
}
