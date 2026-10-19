"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEngine } from "./engine-provider";
import { Icon } from "./icon";
import { IconSprite } from "./icon-sprite";

const groups = [
  ["WORKSPACE", [["/app", "home", "Dashboard"], ["/sources", "video", "Nguồn video"]]],
  ["THƯ VIỆN", [["/downloads", "download", "Video đã tải"], ["/outputs", "sparkles", "Thành phẩm"], ["/favorites", "heart", "Video yêu thích", "sidebarFavorites"], ["/collections", "folder", "Collections"], ["/series", "folder", "Series"], ["/history", "history", "Lịch sử"], ["/sources?view=tracked", "radio", "Nguồn theo dõi", "trackedSourcesNav"]]],
  ["HỆ THỐNG", [["/settings", "settings", "Cài đặt"], ["/admin/users", "grid", "Quản trị tài khoản"]]],
];
const pages = {
  "/app": ["Dashboard", "Tổng quan hệ thống xử lý video · DB realtime"],
  "/sources": ["Nguồn video", "Tìm video nguồn, tải xuống và chạy Vietsub / Voice AI"],
  "/downloads": ["Video đã tải", "Thư viện video nguồn được lưu trên máy của bạn"],
  "/outputs": ["Thành phẩm", "Xem lại và tải video Vietsub / Voice đã hoàn tất"],
  "/favorites": ["Video yêu thích", "Những video đã đánh dấu trong thư viện local"],
  "/collections": ["Collections", "Sắp xếp video theo bộ sưu tập trên máy của bạn"],
  "/series": ["Series", "Các series và danh sách tập từ nguồn video"],
  "/history": ["Lịch sử", "Theo dõi lịch sử xử lý và kết quả của từng job"],
  "/settings": ["Cài đặt", "Thông tin cấu hình hiện tại của Reup AI"],
};
const labels = { checking: "Đang kiểm tra", connected: "Đã kết nối", disconnected: "Local Engine offline", authorization_required: "Cần cấp quyền", authorizing: "Đang cấp quyền", permission_denied: "Quyền bị từ chối", update_required: "Cần cập nhật Local Engine", error: "Lỗi kết nối" };

function StatusControl() {
  const { status, error, check, connect, revoke, client } = useEngine();
  const busy = status === "checking" || status === "authorizing";
  const visual = status === "checking" && client.hasPersistentGrant ? "reconnecting" : status;
  return <div className="topbar-user engine-status-control">
    <span className="local-engine-indicator" id="localEngineIndicator" data-state={visual} title={client.baseUrl}>
      <span className="local-engine-dot" /><span id="localEngineLabel">{visual === "reconnecting" ? "Đang kết nối lại" : labels[status]}</span>
    </span>
    {status === "connected" ? <button id="localEngineRevoke" className="local-engine-action" onClick={revoke}>Thu hồi</button> : <button id="localEngineConnect" className="local-engine-action" disabled={busy} onClick={status === "authorization_required" || status === "permission_denied" ? connect : check}>{busy ? "Đang kết nối…" : status === "authorization_required" || status === "permission_denied" ? "Kết nối ReupAI" : "Thử lại"}</button>}
    <button id="localEngineRetry" className="local-engine-action engine-retry" disabled={busy} title="Kiểm tra kết nối" aria-label="Kiểm tra kết nối" onClick={check}><Icon name="refresh" size={15} /></button>
    {error && <span className="sr-only">{error.message}</span>}
  </div>;
}

export function AppShell({ children }) {
  const pathname = usePathname();
  const [title, subtitle] = pages[pathname] || ["Reup AI", "Video workspace"];
  return <><IconSprite /><div className="app-shell">
    <aside className="sidebar">
      <Link href="/app" className="brand" aria-label="Reup AI Dashboard"><span className="brand-mark">R</span><span className="brand-copy"><strong>Reup AI</strong><small>V12.1</small></span></Link>
      <nav className="nav" aria-label="Điều hướng chính">{groups.map(([label, links]) => <div className="nav-group" key={label}><span className="nav-label">{label}</span>{links.map(([href, icon, text, id]) => <Link id={id} key={href} href={href} className={`nav-item ${pathname === href.split("?")[0] ? "active" : ""}`}><span className="nav-icon"><svg className="ui-icon" aria-hidden="true"><use href={`#ui-${icon}`} /></svg></span><span>{text}</span></Link>)}</div>)}</nav>
      <div className="sidebar-user"><div className="avatar"><Icon name="grid" size={17} /></div><div className="sidebar-user-info"><strong>Máy của bạn</strong><small>LOCAL WORKSPACE</small></div><Link className="logout-icon" href="/settings" title="Cài đặt Local Engine"><Icon name="settings" size={17} /></Link></div>
    </aside>
    <main className="main"><header className="topbar"><div><span className="topbar-kicker">REUP AI <i /> VIDEO WORKSPACE</span><h1>{title}</h1><p>{subtitle}</p></div><StatusControl /></header><section className="page-content">{children}</section></main>
  </div></>;
}
