import Link from "next/link";
import { REUPAI_MICROSOFT_STORE_URL } from "../../src/lib/store-links";

export const metadata = {
  title: "Tải ReupAI Local Engine cho Windows | Vietsub video",
  description: "Tải ReupAI Local Engine cho Windows để tải video, tạo Vietsub AI, dịch phụ đề và lồng tiếng video ngay trên máy tính.",
};

export default function LocalEnginePage() {
  return <main className="plans-page">
    <header className="plans-nav"><Link href="/" className="plans-brand">Reup<span>AI</span></Link><Link href="/app">Vào workspace →</Link></header>
    <div className="plans-content engine-download-page">
      <p className="plans-eyebrow">ỨNG DỤNG WINDOWS BẮT BUỘC</p>
      <h1>Vì sao cần Local Engine?</h1>
      <p className="plans-intro">Website dùng để quản lý tài khoản và điều khiển công việc. Local Engine mới là phần mềm thực sự tải, phân tích và render video trên máy của bạn.</p>
      <div className="engine-reason-grid">
        <article><strong>File nằm trên máy bạn</strong><p>Video nguồn và thành phẩm không bị tải lên máy chủ ReupAI.</p></article>
        <article><strong>Bộ xử lý đầy đủ</strong><p>Local Engine chứa FFmpeg, Whisper, nhận diện phụ đề và giọng đọc AI.</p></article>
        <article><strong>Kết nối Gemini an toàn</strong><p>Phiên Google và project Gemini được lưu mã hóa trên chính máy này.</p></article>
        <article><strong>Website không thể tự render</strong><p>Trình duyệt không có quyền chạy pipeline video, đọc file local hoặc xử lý dài hạn như ứng dụng Windows.</p></article>
      </div>
      <section className="engine-download-card">
        <div><small>WINDOWS 10/11 · 64-BIT · MICROSOFT STORE</small><h2>ReupAI Local Engine</h2><p>Cài bản đã được Microsoft chứng nhận. Sau khi cài, mở ứng dụng rồi quay lại website và bấm “Kết nối ReupAI”.</p></div>
        <a className="plans-button primary" href={REUPAI_MICROSOFT_STORE_URL} target="_blank" rel="noopener noreferrer">Tải từ Microsoft Store →</a>
      </section>
      <section className="engine-download-card">
        <div><h2>Cập nhật mà không mất thư viện</h2><p>Bản cài từ Microsoft Store nhận cập nhật qua Store. Nếu bạn đang dùng bản cài trực tiếp cũ, hãy dùng chức năng “Cập nhật ngay” trong website để cập nhật đúng kênh đó.</p><p>Đừng gỡ dữ liệu hoặc xóa thư viện để cập nhật. Nếu bản cài cũ báo đang có công việc, hãy chờ hoặc thoát Local Engine ở khay hệ thống rồi thử lại.</p></div>
      </section>
      <p className="plans-footnote">Trang Store sẽ mở để bạn cài ReupAI. Yêu cầu Windows 10/11 64-bit và khoảng 1,5 GB dung lượng trống.</p>
    </div>
  </main>;
}
