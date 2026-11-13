"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useGuestAccess } from "./guest-access";
import { Icon } from "./icon";

const SOURCE_DRAFT_KEY = "reupai:guest-source-draft";
const pages = {
  downloads: { icon: "download", eyebrow: "THƯ VIỆN NGUỒN", title: "Video đã tải", description: "Tập trung video nguồn, sẵn sàng cho bước sáng tạo tiếp theo.", emptyTitle: "Thư viện video của riêng bạn.", emptyDescription: "Đăng nhập để xem video đã tải hoặc thêm nguồn mới. Nội dung và file trên máy luôn gắn với tài khoản của bạn.", action: "Thêm video", actionNext: "/sources", filters: ["Tất cả", "Mới nhất", "Theo tên"] },
  outputs: { icon: "spark", eyebrow: "THƯ VIỆN THÀNH PHẨM", title: "Thành phẩm", description: "Nơi những ý tưởng trở thành video hoàn chỉnh.", emptyTitle: "Không gian cho những bản hoàn thiện.", emptyDescription: "Đăng nhập để xem, tải hoặc chỉnh sửa video của bạn. Mỗi lần xử lý hoàn tất sẽ xuất hiện tại đây.", action: "Tạo thành phẩm", actionNext: "/sources", filters: ["Tất cả", "Vietsub", "Vietsub + Voice"] },
  favorites: { icon: "heart", eyebrow: "ĐƯỢC BẠN LỰA CHỌN", title: "Video yêu thích", description: "Lưu lại những video bạn muốn quay lại.", emptyTitle: "Giữ cảm hứng ở một nơi.", emptyDescription: "Đăng nhập để xem các video đã đánh dấu và lưu thêm những ý tưởng bạn yêu thích.", action: "Khám phá nguồn", actionNext: "/sources", filters: ["Tất cả", "Bilibili", "Douyin"] },
  collections: { icon: "folder", eyebrow: "SẮP XẾP THEO CÁCH CỦA BẠN", title: "Bộ sưu tập", description: "Gom nguồn và video theo từng ý tưởng, chủ đề hoặc dự án.", emptyTitle: "Một chỗ cho mỗi ý tưởng.", emptyDescription: "Đăng nhập để mở bộ sưu tập của bạn hoặc tạo nhóm video mới. Các dự án cá nhân chỉ hiển thị với tài khoản đã đăng nhập.", action: "Tạo bộ sưu tập", actionNext: "/collections", filters: ["Tất cả", "Mới nhất", "Theo tên"] },
  series: { icon: "folder", eyebrow: "THEO DÕI TỪNG TẬP", title: "Series", description: "Quản lý các tập và danh sách video trong cùng một mạch nội dung.", emptyTitle: "Câu chuyện dài, quản lý gọn.", emptyDescription: "Đăng nhập để xem các series đã lưu và sắp xếp từng tập trước khi xử lý.", action: "Thêm series", actionNext: "/series", filters: ["Tất cả", "Mới nhất", "Theo tên"] },
  history: { icon: "history", eyebrow: "MỖI BƯỚC ĐỀU CÓ DẤU VẾT", title: "Lịch sử", description: "Theo dõi những lần xử lý và mở lại kết quả khi cần.", emptyTitle: "Hành trình sáng tạo của bạn.", emptyDescription: "Đăng nhập để xem tiến độ, lịch sử xử lý và chi tiết công việc. Dữ liệu cá nhân được giữ riêng theo tài khoản.", action: "Bắt đầu xử lý", actionNext: "/sources", filters: ["Tất cả", "Hoàn tất", "Đang xử lý", "Cần kiểm tra"] },
};

function EmptyOrbit({ icon }) {
  return <div className="guest-empty-orbit" aria-hidden="true"><span className="guest-empty-ring ring-one" /><span className="guest-empty-ring ring-two" /><span className="guest-empty-core"><Icon name={icon} size={27} /></span><span className="guest-empty-satellite"><Icon name="spark" size={12} /></span><span className="guest-empty-point" /></div>;
}

export function GuestBrowsePage({ page = "sources" }) {
  const { requestSignIn } = useGuestAccess();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Tất cả");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState("video");
  const [status, setStatus] = useState("all");
  const isSource = page === "sources";
  const config = pages[page] || pages.downloads;
  const hasQuery = query.trim().length > 0;

  useEffect(() => { setQuery(""); setFilter("Tất cả"); setStatus("all"); }, [page]);

  useEffect(() => {
    if (!isSource) return;
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(SOURCE_DRAFT_KEY) || "null");
      if (draft && Date.now() - Number(draft.createdAt) < 30 * 60 * 1000) {
        setUrl(typeof draft.url === "string" ? draft.url : "");
        setMode(draft.mode === "channel" ? "channel" : "video");
      }
    } catch { /* A damaged or unavailable draft does not block browsing. */ }
  }, [isSource]);

  function requestSource(event, follow = false) {
    event?.preventDefault();
    try { window.sessionStorage.setItem(SOURCE_DRAFT_KEY, JSON.stringify({ url: url.trim(), mode, createdAt: Date.now() })); }
    catch { /* Login remains available when session storage is unavailable. */ }
    requestSignIn({ next: "/sources", reason: follow ? "Đăng nhập để theo dõi nguồn và lưu cập nhật vào tài khoản của bạn." : "Đăng nhập để đồng bộ nguồn video và bắt đầu xử lý nội dung của bạn." });
  }

  function requestLibrary(action = false) {
    requestSignIn({ next: action ? config.actionNext : `/${page}`, reason: action ? `Đăng nhập để ${config.action.toLocaleLowerCase("vi-VN")} và lưu công việc của bạn.` : "Đăng nhập để mở dữ liệu riêng trong thư viện của bạn." });
  }

  const filters = isSource ? ["Tất cả", "Bilibili", "Douyin"] : config.filters;

  return <div className={`guest-browse${isSource ? " is-sources" : " is-library"}`}>
    <section className="guest-browse-heading">
      <div><p className="guest-browse-eyebrow"><span />{isSource ? "CHỌN NGUỒN. BẮT ĐẦU SÁNG TẠO." : config.eyebrow}</p><h2>{isSource ? "Video tiếp theo bắt đầu từ đây." : config.title}</h2><p>{isSource ? "Dán link Bilibili hoặc Douyin. Đăng nhập khi bạn muốn đồng bộ và xử lý video." : config.description}</p></div>
      <Link href="/giai-phap" className="guest-browse-help"><Icon name="external" size={13} />Hướng dẫn</Link>
    </section>

    {isSource && <form className="guest-source-form" onSubmit={requestSource}>
      <div className="guest-source-label"><span className="guest-source-mark"><Icon name="source" size={17} /></span><div><label htmlFor="guest-source-url">Thêm nguồn video</label><p>Một video hoặc cả kênh, theo cách của bạn.</p></div></div>
      <div className="guest-source-controls"><div className="guest-source-input"><Icon name="external" size={16} /><input id="guest-source-url" type="text" inputMode="url" autoComplete="url" spellCheck={false} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Dán link video hoặc kênh Bilibili / Douyin…" aria-label="Link nguồn video hoặc kênh" /></div><select value={mode} onChange={(event) => setMode(event.target.value)} aria-label="Loại nguồn"><option value="video">Một video</option><option value="channel">Cả kênh</option></select><button className="guest-source-sync" type="submit"><Icon name="refresh" size={14} />Đồng bộ nguồn</button><button className="guest-source-follow" type="button" onClick={(event) => requestSource(event, true)}><Icon name="plus" size={14} />Theo dõi</button></div>
      <p className="guest-source-caption"><span />Bạn có thể khám phá giao diện trước. Đồng bộ nguồn cần đăng nhập.</p>
    </form>}

    <section className="guest-browse-library" aria-label={isSource ? "Danh sách video nguồn" : config.title}>
      <div className="guest-browse-toolbar"><div className="guest-browse-filters" role="group" aria-label={isSource ? "Lọc nền tảng" : "Lọc thư viện"}>{filters.map((item) => <button type="button" key={item} aria-pressed={filter === item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "Bilibili" && <span className="guest-platform-dot" />}{item === "Douyin" && <span className="guest-platform-dot is-douyin" />}{item}</button>)}</div><div className="guest-browse-search"><Icon name="search" size={15} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isSource ? "Tìm video trong nguồn…" : "Tìm trong thư viện…"} aria-label={isSource ? "Tìm video nguồn" : `Tìm trong ${config.title.toLocaleLowerCase("vi-VN")}`} /></div>{isSource ? <select className="guest-browse-status" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Trạng thái video"><option value="all">Tất cả trạng thái</option><option value="new">Chưa tải</option><option value="downloaded">Đã tải</option></select> : config.actionNext === "/sources" ? <Link className="guest-library-add" href="/sources"><Icon name="plus" size={14} />{config.action}</Link> : <button type="button" className="guest-library-add" onClick={() => requestLibrary(true)}><Icon name="plus" size={14} />{config.action}</button>}</div>
      <div className="guest-browse-empty" role="status" aria-live="polite">
        <EmptyOrbit icon={hasQuery ? "search" : isSource ? "play" : config.icon} />
        <h3>{hasQuery ? `Chưa có kết quả cho “${query.trim()}”.` : isSource ? filter === "Tất cả" ? "Chọn nguồn cho ý tưởng tiếp theo." : `Khám phá video từ ${filter}.` : config.emptyTitle}</h3>
        <p>{hasQuery ? "Chưa có dữ liệu cá nhân để tìm kiếm khi bạn đang ở chế độ khách. Đăng nhập để mở thư viện đã lưu của bạn." : isSource ? "Nguồn đã đồng bộ sẽ xuất hiện ở đây. Dán một liên kết phía trên, rồi đăng nhập khi bạn sẵn sàng thêm video." : config.emptyDescription}</p>
        <div className="guest-empty-actions">{isSource ? <><button type="button" className="guest-empty-primary" onClick={requestSource}>Đồng bộ nguồn đầu tiên</button><Link href="/giai-phap">Tìm hiểu cách sử dụng</Link></> : <><button type="button" className="guest-empty-primary" onClick={() => requestLibrary(false)}>Xem thư viện của tôi</button>{config.actionNext === "/sources" ? <Link className="guest-empty-secondary" href="/sources">{config.action}</Link> : <button type="button" className="guest-empty-secondary" onClick={() => requestLibrary(true)}>{config.action}</button>}</>}</div>
        <span className="guest-library-private"><Icon name="lock" size={12} />Thư viện cá nhân chỉ hiển thị sau khi đăng nhập.</span>
      </div>
      <div className="guest-browse-footnote"><span>{isSource ? "Nguồn của bạn" : config.title}</span><span>{filter}{status !== "all" && isSource ? ` · ${status === "new" ? "Chưa tải" : "Đã tải"}` : ""}</span></div>
    </section>
  </div>;
}
