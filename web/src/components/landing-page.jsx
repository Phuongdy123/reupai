import Link from "next/link";

export function LandingPage() {
  return <main className="account-shell landing-shell">
    <header className="landing-nav"><div className="landing-brand"><span>R</span><strong>Reup AI</strong></div><div className="landing-nav-actions"><Link href="/sign-in" className="button-secondary">Đăng nhập</Link><Link href="/sign-up" className="button-primary">Tạo tài khoản</Link></div></header>
    <section className="landing-hero"><p className="eyebrow">LOCAL-FIRST VIDEO WORKSPACE</p><h1>Xử lý video AI<br />ngay trên máy của bạn.</h1><p className="landing-lede">Tải, Vietsub, lồng tiếng và render video bằng Local Engine. Video, dự án và file thành phẩm không rời khỏi máy của bạn.</p><div className="landing-actions"><Link href="/sign-up" className="button-primary button-large">Đăng ký dùng Reup AI</Link><Link href="/sign-in" className="button-secondary button-large">Đăng nhập</Link></div></section>
    <section className="landing-features"><article><b>Local Engine</b><span>Xử lý bằng CPU/GPU máy của bạn</span></article><article><b>Quyền truy cập</b><span>Tài khoản mới chờ quản trị viên duyệt</span></article><article><b>Private by design</b><span>Không tải video hay dự án lên cloud</span></article></section>
  </main>;
}
