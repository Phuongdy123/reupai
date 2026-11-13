import { WorkspaceAccess } from "../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import Link from "next/link";

export const metadata = { title: "Trợ giúp", robots: { index: false, follow: false } };
export default function Page() {
  return <WorkspaceAccess page="help"><div className="help-page"><h2>Bắt đầu với ReupAI</h2><p>Hướng dẫn nhanh cho các thao tác thường dùng.</p><div className="help-grid"><article><h3>1. Cài Local Engine</h3><p>Ứng dụng Windows này tải và xử lý video ngay trên máy; website một mình không thể render video.</p><Link href="/local-engine">Tải Local Engine →</Link></article><article><h3>2. Kết nối máy</h3><p>Mở ReupAI Local Engine, sau đó cấp quyền kết nối trong trình duyệt.</p><Link href="/settings">Mở Cài đặt →</Link></article><article><h3>3. Thêm video</h3><p>Dán link nguồn được hỗ trợ, xem trước video rồi chọn Vietsub hoặc Voice.</p><Link href="/sources">Mở Nguồn video →</Link></article><article><h3>4. Kiểm tra Gemini</h3><p>Nếu quyền Google hết hạn, kết nối lại trong Cài đặt. Mỗi khách dùng Google Cloud project riêng.</p><Link href="/settings#diagnostics">Kiểm tra Gemini →</Link></article><article><h3>Gửi phản hồi cho ReupAI</h3><p>Báo lỗi, gửi link video hoặc góp ý trực tiếp để quản trị viên xem và xử lý.</p><Link href="/feedback">Gửi phản hồi →</Link></article></div></div></WorkspaceAccess>;
}
