"use client";

import Link from "next/link";

const columns = [
  { title: "Khám phá", links: [["Vietsub video AI", "/giai-phap/vietsub-video-ai"], ["Dịch Trung–Việt", "/giai-phap/dich-video-trung-viet"], ["Lồng tiếng AI", "/giai-phap/long-tieng-video-ai"], ["Tất cả hướng dẫn", "/giai-phap"]] },
  { title: "ReupAI", links: [["Gói Free & Pro", "/plans"], ["Local Engine", "/giai-phap/xu-ly-video-tren-may"], ["Tạo tài khoản", "/sign-up"], ["Đăng nhập", "/sign-in"]] },
];

export function PublicFooter({ variant = "default" }) {
  return <footer className={`public-footer${variant === "workspace" ? " public-footer-workspace" : ""}`}>
    <div className="public-footer-main">
      <div className="public-footer-intro">
        <Link href="/" className="public-footer-brand" aria-label="ReupAI - Trang chủ">Reup<span>AI</span></Link>
        <p>Từ video nguồn đến Vietsub, lồng tiếng và thành phẩm. Bạn chọn cách xử lý, Local Engine thực hiện trên máy của bạn.</p>
        <span className="public-footer-local"><i aria-hidden="true" /> Video và thành phẩm lưu trên thiết bị</span>
      </div>
      {columns.map((column) => <nav key={column.title} aria-label={column.title} className="public-footer-column"><h2>{column.title}</h2>{column.links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</nav>)}
      <div className="public-footer-contact"><h2>Cần hỗ trợ?</h2><p>Gửi câu hỏi hoặc mã job để được hướng dẫn cụ thể.</p><a href="mailto:phuongndps39487@gmail.com?subject=Ho%20tro%20ReupAI">Liên hệ hỗ trợ <span aria-hidden="true">↗</span></a></div>
    </div>
    <div className="public-footer-bottom"><span>© {new Date().getFullYear()} ReupAI. AI Video Workspace.</span><div><Link href="/privacy">Quyền riêng tư</Link><Link href="/terms">Điều khoản</Link></div></div>
  </footer>;
}
