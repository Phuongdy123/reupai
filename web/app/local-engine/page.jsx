import Link from "next/link";

export const metadata = {
  title: "Tải ReupAI Local Engine cho Windows | Vietsub video",
  description: "Tải ReupAI Local Engine cho Windows để tải video, tạo Vietsub AI, dịch phụ đề và lồng tiếng video ngay trên máy tính.",
};

export default function LocalEnginePage() {
  const downloadUrl = process.env.NEXT_PUBLIC_LOCAL_ENGINE_DOWNLOAD_URL || "";
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
        <div><small>WINDOWS 10/11 · 64-BIT</small><h2>ReupAI Local Engine</h2><p>Sau khi cài, mở ứng dụng rồi quay lại website và bấm “Kết nối ReupAI”.</p></div>
        {downloadUrl ? <a className="plans-button primary" href={downloadUrl}>Tải bản Windows →</a> : <button className="plans-button primary" type="button" disabled>Bản cài đang được chuẩn bị</button>}
      </section>
      {!downloadUrl && <div className="plans-banner" role="status">Kênh tải công khai chưa được cấu hình. Quản trị viên cần đặt biến <code>NEXT_PUBLIC_LOCAL_ENGINE_DOWNLOAD_URL</code> tới file cài chính thức.</div>}
      <p className="plans-footnote">Yêu cầu khoảng 1,5 GB dung lượng trống. Chỉ tải bộ cài từ liên kết chính thức của ReupAI.</p>
    </div>
  </main>;
}
