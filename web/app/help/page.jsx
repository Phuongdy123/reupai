import { WorkspaceAccess } from "../../src/components/workspace-access";
import { SITE_URL } from "../../src/lib/seo-guides";
import { REUPAI_MICROSOFT_STORE_URL } from "../../src/lib/store-links";
export const dynamic = "force-dynamic";
import Link from "next/link";

export const metadata = {
  title: "Trung tâm Trợ giúp & Hướng dẫn cài đặt ReupAI Local Engine",
  description: "Hướng dẫn cài đặt ReupAI từ Microsoft Store, kết nối Local Engine, sử dụng phần mềm Reup video tự động, làm Vietsub AI, OCR phụ đề cứng và lồng tiếng 31 giọng đọc.",
  alternates: { canonical: "/help" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Trung tâm Trợ giúp & Hướng dẫn ReupAI",
    description: "Hướng dẫn nhanh cài đặt ReupAI Local Engine từ Microsoft Store và quy trình Reup video tự động bằng AI.",
    url: `${SITE_URL}/help`,
    type: "website",
    locale: "vi_VN",
    siteName: "ReupAI",
  },
};

export default function Page() {
  return <WorkspaceAccess page="help"><div className="help-page"><h1>Trung tâm Trợ giúp &amp; Hướng dẫn ReupAI</h1><p>Hướng dẫn nhanh cho các thao tác cài đặt ReupAI Local Engine từ Microsoft Store và xử lý video tự động.</p><div className="help-grid"><article><h3>1. Cài ReupAI từ Microsoft Store</h3><p>Ứng dụng Windows chính thức tải và xử lý video ngay trên máy tính của bạn.</p><Link href="/local-engine">Tải Local Engine →</Link></article><article><h3>2. Kết nối máy</h3><p>Mở ReupAI Local Engine trên Windows, sau đó cấp quyền kết nối trong trình duyệt.</p><Link href="/settings">Mở Cài đặt →</Link></article><article><h3>3. Quy trình Reup video tự động</h3><p>Dán link Bilibili/Douyin, tự động che chữ Trung, dịch Vietsub và lồng tiếng 31 giọng AI.</p><Link href="/giai-phap/reup-video-tu-dong-bang-ai">Xem hướng dẫn Reup tự động →</Link></article><article><h3>4. Khám phá 24 Giải pháp AI</h3><p>Xem trọn bộ hướng dẫn tách phụ đề OCR, làm review phim, cắt Shorts 9:16 và đăng đa kênh.</p><Link href="/giai-phap">Tất cả 24 hướng dẫn →</Link></article><article><h3>5. Tải trực tiếp trên Microsoft Store</h3><p>Cài đặt và nhận bản cập nhật tự động qua cửa hàng ứng dụng chính thức của Windows.</p><a href={REUPAI_MICROSOFT_STORE_URL} target="_blank" rel="noopener noreferrer">Mở Microsoft Store ↗</a></article><article><h3>Gửi phản hồi cho ReupAI</h3><p>Báo lỗi, gửi link video hoặc góp ý trực tiếp để quản trị viên xem và xử lý.</p><Link href="/feedback">Gửi phản hồi →</Link></article></div></div></WorkspaceAccess>;
}
