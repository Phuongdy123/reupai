"use client";

import Link from "next/link";

const columns = [
  {
    title: "Giải pháp AI",
    links: [
      ["Reup video tự động AI", "/giai-phap/reup-video-tu-dong-bang-ai"],
      ["Reup TikTok, Reels & Shorts", "/giai-phap/phan-mem-reup-video-tiktok-reels-shorts"],
      ["Vietsub video AI", "/giai-phap/vietsub-video-ai"],
      ["Dịch video Trung–Việt", "/giai-phap/dich-video-trung-viet"],
      ["Dịch video Anh, Nhật, Hàn", "/giai-phap/dich-video-tieng-anh-nhat-han-sang-tieng-viet"],
      ["Review phim & Hoạt hình AI", "/giai-phap/lam-video-review-phim-truyen-tranh-ai"],
      ["Thuyết minh Trung Quốc AI", "/giai-phap/thuyet-minh-video-trung-quoc-ai"],
      ["31 giọng TTS tiếng Việt", "/giai-phap/chuyen-van-ban-thanh-giong-noi-tieng-viet"],
    ],
  },
  {
    title: "Nền tảng & Công cụ",
    links: [
      ["Tải Douyin & Bilibili hàng loạt", "/giai-phap/tai-video-douyin-bilibili-hang-loat"],
      ["Xóa chữ Trung & che hardsub", "/giai-phap/xoa-chu-trung-quoc-che-hardsub-video"],
      ["Tách phụ đề OCR ra SRT", "/giai-phap/tach-phu-de-cung-ocr-video"],
      ["Render video hàng loạt", "/giai-phap/chinh-sua-render-video-hang-loat-tren-may"],
      ["Đăng YouTube, Reels, TikTok", "/giai-phap/dang-video-youtube-facebook-tiktok-tu-dong"],
      ["Biên tập Reup an toàn AI", "/giai-phap/cach-bien-tap-video-reup-bang-ai-an-toan"],
      ["Vietsub hàng loạt Series", "/giai-phap/vietsub-hang-loat-theo-series"],
      ["Xuất & chỉnh phụ đề SRT", "/giai-phap/xuat-va-chinh-sua-phu-de-srt"],
    ],
  },
  {
    title: "ReupAI",
    links: [
      ["Tải Local Engine Windows", "/local-engine"],
      ["Tất cả 24 hướng dẫn", "/giai-phap"],
      ["Bảng giá Free & Pro", "/plans"],
      ["Tạo tài khoản", "/sign-up"],
      ["Đăng nhập", "/sign-in"],
    ],
  },
];

export function PublicFooter({ variant = "default" }) {
  return <footer className={`public-footer${variant === "workspace" ? " public-footer-workspace" : ""}`}>
    <div className="public-footer-main">
      <div className="public-footer-intro">
        <Link href="/" className="public-footer-brand" aria-label="ReupAI - Trang chủ">Reup<span>AI</span></Link>
        <p>Từ video nguồn đến Vietsub, lồng tiếng và thành phẩm. Mọi công cụ sáng tạo trong một không gian làm việc.</p>
      </div>
      {columns.map((column) => <nav key={column.title} aria-label={column.title} className="public-footer-column"><h2>{column.title}</h2>{column.links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</nav>)}
      <div className="public-footer-contact"><h2>Cần hỗ trợ?</h2><p>Gửi câu hỏi hoặc mã job để được hướng dẫn cụ thể.</p><a href="mailto:phuongndps39487@gmail.com?subject=Ho%20tro%20ReupAI">Liên hệ hỗ trợ <span aria-hidden="true">↗</span></a></div>
    </div>
    <div className="public-footer-bottom"><span>© {new Date().getFullYear()} ReupAI. AI Video Workspace.</span><div><Link href="/privacy">Quyền riêng tư</Link><Link href="/terms">Điều khoản</Link></div></div>
  </footer>;
}
