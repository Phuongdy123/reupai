"use client";

import Link from "next/link";

const columns = [
  {
    title: "Giải pháp AI",
    links: [
      ["Vietsub video AI", "/giai-phap/vietsub-video-ai"],
      ["Dịch video Trung–Việt", "/giai-phap/dich-video-trung-viet"],
      ["Thuyết minh Trung Quốc AI", "/giai-phap/thuyet-minh-video-trung-quoc-ai"],
      ["Tách phụ đề OCR ra SRT", "/giai-phap/tach-phu-de-cung-ocr-video"],
      ["31 giọng TTS tiếng Việt", "/giai-phap/chuyen-van-ban-thanh-giong-noi-tieng-viet"],
    ],
  },
  {
    title: "Nền tảng & Xuất bản",
    links: [
      ["Vietsub video Bilibili", "/giai-phap/vietsub-video-bilibili"],
      ["Vietsub video Douyin", "/giai-phap/vietsub-video-douyin"],
      ["Làm YouTube Shorts & Reels", "/giai-phap/lam-video-youtube-shorts-reup-ai"],
      ["Vietsub hàng loạt Series", "/giai-phap/vietsub-hang-loat-theo-series"],
      ["Xuất & chỉnh phụ đề SRT", "/giai-phap/xuat-va-chinh-sua-phu-de-srt"],
    ],
  },
  {
    title: "ReupAI",
    links: [
      ["Tải Local Engine Windows", "/local-engine"],
      ["Tất cả hướng dẫn", "/giai-phap"],
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
