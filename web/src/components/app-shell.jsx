"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useEngine } from "./engine-provider";
import { useBilling } from "./billing-provider";
import { Icon } from "./icon";
import { EngineUpdateNotice } from "./engine-update-notice";
import { GeminiSetupRedirect } from "./gemini-setup-redirect";
import { IconSprite } from "./icon-sprite";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";

const groups = [
  ["WORKSPACE", [["/app", "home", "Trang chủ"], ["/sources", "video", "Nguồn video"]]],
  ["THƯ VIỆN", [["/downloads", "download", "Video đã tải"], ["/outputs", "sparkles", "Thành phẩm"], ["/favorites", "heart", "Video yêu thích", "sidebarFavorites"], ["/collections", "folder", "Collections"], ["/series", "folder", "Series"], ["/history", "history", "Lịch sử"], ["/sources?view=tracked", "radio", "Nguồn theo dõi", "trackedSourcesNav"]]],
  ["TÀI KHOẢN", [["/profile", "user", "Hồ sơ"], ["/plans", "sparkles", "Gói dịch vụ"], ["/settings", "settings", "Cài đặt"], ["/help", "check", "Trợ giúp"], ["/feedback", "mail", "Gửi phản hồi"]]],
];
const pages = {
  "/app": ["Trang chủ", "Trò chuyện với trợ lý và theo dõi công việc xử lý video"],
  "/sources": ["Nguồn video", "Tìm video nguồn, tải xuống và chạy Vietsub / Voice AI"],
  "/downloads": ["Video đã tải", "Thư viện video nguồn được lưu trên máy của bạn"],
  "/outputs": ["Thành phẩm", "Xem lại và tải video Vietsub / Voice đã hoàn tất"],
  "/favorites": ["Video yêu thích", "Những video đã đánh dấu trong thư viện local"],
  "/collections": ["Collections", "Sắp xếp video theo bộ sưu tập trên máy của bạn"],
  "/series": ["Series", "Các series và danh sách tập từ nguồn video"],
  "/history": ["Lịch sử", "Theo dõi lịch sử xử lý và kết quả của từng job"],
  "/settings": ["Cài đặt", "Thông tin cấu hình hiện tại của ReupAI"],
  "/profile": ["Hồ sơ", "Quản lý thông tin tài khoản và gói đang dùng"],
  "/help": ["Trợ giúp", "Hướng dẫn nhanh và xử lý sự cố thường gặp"],
  "/feedback": ["Gửi phản hồi", "Báo lỗi và góp ý trực tiếp cho đội ngũ ReupAI"],
  "/admin/feedback": ["Phản hồi khách hàng", "Đọc và quản lý phản hồi từ người dùng"],
};
const labels = { checking: "Đang kiểm tra", connected: "Đã kết nối", disconnected: "Chưa kết nối", authorization_required: "Cần kết nối", authorizing: "Đang kết nối", permission_denied: "Cần cấp quyền", update_required: "Cần cập nhật", error: "Lỗi kết nối" };

function StatusControl() {
  const { status, error, check, connect, client } = useEngine();
  const busy = status === "checking" || status === "authorizing";
  const visual = status === "checking" && client.hasPersistentGrant ? "reconnecting" : status;
  return <div className="topbar-user engine-status-control">
    <span className="local-engine-indicator" id="localEngineIndicator" data-state={visual} title={client.baseUrl}>
      <span className="local-engine-dot" /><span id="localEngineLabel">{visual === "reconnecting" ? "Đang kết nối lại" : labels[status]}</span>
    </span>
    {status !== "connected" && <button id="localEngineConnect" className="local-engine-action" disabled={busy} onClick={status === "authorization_required" || status === "permission_denied" ? connect : check}>{busy ? "Đang kết nối…" : status === "authorization_required" || status === "permission_denied" ? "Kết nối ReupAI" : "Thử lại"}</button>}
    {status === "connected" && <button id="localEngineRetry" className="local-engine-action engine-retry" title="Kiểm tra kết nối" aria-label="Kiểm tra kết nối" onClick={check}><Icon name="refresh" size={15} /></button>}
    {error && <span className="sr-only">{error.message}</span>}
  </div>;
}

function AccountAvatar({ identity, className = "" }) {
  const initial = (identity?.name || identity?.email || "R").slice(0, 1).toUpperCase();
  return <span className={`account-avatar ${className}`.trim()} aria-hidden="true">
    <span>{initial}</span>
    {identity?.avatarUrl && <img src={identity.avatarUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
  </span>;
}

function AccountSignOut({ menu = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (isSupabaseConfigured()) {
        const { error: authError } = await createClient().auth.signOut({ scope: "local" });
        if (authError) throw authError;
      }
      window.sessionStorage.removeItem("reupai:assistant-chat-v1");
      window.sessionStorage.removeItem("reupai:assistant-pending-source");
      window.location.replace("/sign-in");
    } catch {
      setError("Không thể đăng xuất. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  return <div className={`account-signout-wrap${menu ? " is-menu" : ""}`}>
    <button type="button" className={`account-signout${menu ? " account-menu-signout" : ""}`} onClick={signOut} disabled={busy} title="Đăng xuất tài khoản ReupAI">
      <Icon name="logout" size={17} /> {busy ? "Đang đăng xuất…" : "Đăng xuất"}
    </button>
    {error && <span className="account-signout-error" role="alert">{error}</span>}
  </div>;
}

export function AppShell({ children }) {
  const pathname = usePathname();
  const [title, subtitle] = pages[pathname] || ["ReupAI", "Video workspace"];
  const [identity, setIdentity] = useState(null);
  const { account: billing } = useBilling();
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarRef = useRef(null);
  const navToggleRef = useRef(null);
  const quickDialogRef = useRef(null);
  const quickTriggerRef = useRef(null);
  const accountMenuRef = useRef(null);
  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem("reupai:sidebar-collapsed") === "true"); } catch {}
  }, []);
  const toggleSidebar = () => setCollapsed((value) => {
    try { window.localStorage.setItem("reupai:sidebar-collapsed", String(!value)); } catch {}
    return !value;
  });
  useEffect(() => {
    if (!mobileNavOpen && !quickOpen) return;
    const region = quickOpen ? quickDialogRef.current : sidebarRef.current;
    const previousFocus = quickOpen ? quickTriggerRef.current : navToggleRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(region?.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled)') || []).filter((node) => node.getClientRects().length);
    focusable()[0]?.focus();
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const nodes = focusable();
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", trapFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mobileNavOpen, quickOpen]);
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || !active) return;
      const { data: profile } = await supabase.from("profiles").select("display_name,role").eq("id", user.id).maybeSingle();
      if (active) setIdentity({
        email: user.email,
        name: profile?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email,
        role: profile?.role,
        avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || "",
      });
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setQuickOpen((open) => !open); }
      if (event.key === "Escape") { setQuickOpen(false); setAccountOpen(false); setMobileNavOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const closeMenu = (event) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) setAccountOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);
  useEffect(() => { setAccountOpen(false); setMobileNavOpen(false); }, [pathname]);
  const quickLinks = [["/app", "Trang chủ"], ["/sources", "Nguồn video"], ["/downloads", "Video đã tải"], ["/outputs", "Thành phẩm"], ["/history", "Lịch sử"], ["/profile", "Hồ sơ"], ["/plans", "Gói dịch vụ"], ["/settings", "Cài đặt"], ["/feedback", "Gửi phản hồi"]].filter(([, label]) => label.toLocaleLowerCase("vi-VN").includes(quickQuery.trim().toLocaleLowerCase("vi-VN")));
  return <><IconSprite /><GeminiSetupRedirect /><a className="workspace-skip" href="#workspace-main">Bỏ qua điều hướng</a><div className={`app-shell premium-workspace${pathname === "/app" ? " is-dashboard" : ""}${collapsed ? " is-collapsed" : ""}${mobileNavOpen ? " is-nav-open" : ""}`}>
    {mobileNavOpen && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setMobileNavOpen(false)} />}
    <aside className="sidebar" id="workspace-sidebar" ref={sidebarRef} role={mobileNavOpen ? "dialog" : undefined} aria-modal={mobileNavOpen || undefined} aria-label="Điều hướng ReupAI">
      <button type="button" className="sidebar-mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Đóng điều hướng">×</button>
      <Link href="/app" className="brand" aria-label="ReupAI Dashboard"><span className="brand-mark"><img src="/images/reupai-logo.png" alt="" /></span><span className="brand-copy"><strong>ReupAI</strong><small>WORKSPACE</small></span></Link>
      <nav className="nav" aria-label="Điều hướng chính">{groups.map(([label, links]) => <div className="nav-group" key={label}><span className="nav-label">{label}</span>{links.map(([href, icon, text, id]) => <Link id={id} key={href} href={href} title={text} aria-label={text} onClick={() => setMobileNavOpen(false)} className={`nav-item ${pathname === href.split("?")[0] ? "active" : ""}`}><span className="nav-icon">{icon === "mail" ? <Icon name="mail" size={17} /> : <svg className="ui-icon" aria-hidden="true"><use href={`#ui-${icon}`} /></svg>}</span><span>{text}</span></Link>)}{label === "TÀI KHOẢN" && identity?.role === "admin" && <Link className="nav-item" href="/admin/users"><span className="nav-icon"><Icon name="grid" size={17} /></span><span>Quản trị tài khoản</span></Link>}{label === "TÀI KHOẢN" && identity?.role === "admin" && <Link className={`nav-item ${pathname === "/admin/feedback" ? "active" : ""}`} href="/admin/feedback"><span className="nav-icon"><Icon name="mail" size={17} /></span><span>Phản hồi khách hàng</span></Link>}</div>)}</nav>
      <button type="button" className="sidebar-collapse" onClick={toggleSidebar} aria-expanded={!collapsed} aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"} title={collapsed ? "Mở rộng" : "Thu gọn"}><Icon name="panel" size={18} /><span>Thu gọn thanh bên</span></button>
      <div className="sidebar-user"><AccountAvatar identity={identity} className="avatar" /><div className="sidebar-user-info"><strong>{identity?.name || "Tài khoản"}</strong><small>{identity?.email || "REUPAI WORKSPACE"}</small></div><Link className="logout-icon" href="/profile" title="Hồ sơ tài khoản"><Icon name="user" size={17} /></Link></div>
    </aside>
    <main className="main" id="workspace-main" tabIndex={-1}><header className="topbar"><div className="workspace-page-heading"><button type="button" className="sidebar-mobile-toggle" ref={navToggleRef} onClick={() => setMobileNavOpen(true)} aria-label="Mở điều hướng" aria-expanded={mobileNavOpen} aria-controls="workspace-sidebar"><Icon name="menu" size={20} /></button><div><span className="topbar-kicker">REUPAI <i /> VIDEO WORKSPACE</span><h1>{title}</h1><p>{subtitle}</p></div></div><div className="workspace-account-actions"><button type="button" className="quick-nav-trigger" ref={quickTriggerRef} onClick={() => setQuickOpen(true)}><Icon name="search" size={16} /><span>Tìm chức năng</span><kbd>Ctrl K</kbd></button><StatusControl />{billing?.plan && <Link href="/plans" className={`plan-status-badge plan-status-${billing.plan}`} title="Xem gói dịch vụ"><span aria-hidden="true">{billing.plan === "pro" ? "✦" : billing.plan === "admin" ? "♛" : "●"}</span>{billing.plan === "admin" ? "ADMIN" : billing.plan.toUpperCase()}</Link>}<div className="account-menu-wrap" ref={accountMenuRef}><button type="button" className="topbar-avatar" title="Quản lý tài khoản" aria-label="Mở menu tài khoản" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}><AccountAvatar identity={identity} /></button>{accountOpen && <div className="account-menu" role="menu"><div className="account-menu-header"><AccountAvatar identity={identity} /><div><strong>{identity?.name || "Tài khoản ReupAI"}</strong><small>{identity?.email || "Đang tải thông tin…"}</small></div></div>{billing?.plan && <Link href="/plans" className={`account-plan-current plan-status-${billing.plan}`}><span>{billing.plan === "pro" ? "✦" : billing.plan === "admin" ? "♛" : "●"}</span><span><small>GÓI ĐANG DÙNG</small><strong>{billing.plan === "admin" ? "ReupAI Admin" : billing.plan === "pro" ? "ReupAI Pro" : "ReupAI Free"}</strong></span><Icon name="chevron" size={15} /></Link>}<div className="account-menu-links"><Link href="/profile" role="menuitem"><Icon name="user" size={17} /><span>Quản lý tài khoản</span></Link><Link href="/plans" role="menuitem"><Icon name="spark" size={17} /><span>Gói dịch vụ</span></Link><Link href="/settings" role="menuitem"><Icon name="settings" size={17} /><span>Cài đặt</span></Link><Link href="/help" role="menuitem"><Icon name="check" size={17} /><span>Trợ giúp</span></Link><Link href="/feedback" role="menuitem"><Icon name="mail" size={17} /><span>Gửi phản hồi</span></Link>{identity?.role === "admin" && <Link href="/admin/feedback" role="menuitem"><Icon name="mail" size={17} /><span>Phản hồi khách hàng</span></Link>}</div><AccountSignOut menu /></div>}</div></div></header><EngineUpdateNotice /><section className="page-content">{children}<footer className="workspace-footer"><span>© ReupAI · AI Video Workspace</span><nav><Link href="/plans">Gói dịch vụ</Link><Link href="/help">Trợ giúp</Link><Link href="/feedback">Gửi phản hồi</Link><Link href="/privacy">Quyền riêng tư</Link><Link href="/terms">Điều khoản</Link></nav></footer></section></main>
    {quickOpen && <div className="quick-nav-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setQuickOpen(false); }}><div className="quick-nav-dialog" ref={quickDialogRef} role="dialog" aria-modal="true" aria-label="Tìm chức năng"><input autoFocus placeholder="Tìm chức năng ReupAI…" value={quickQuery} onChange={(event) => setQuickQuery(event.target.value)} /><div>{quickLinks.length ? quickLinks.map(([href, label]) => <Link key={href} href={href} onClick={() => { setQuickOpen(false); setQuickQuery(""); }}>{label}<span>↗</span></Link>) : <p>Không tìm thấy chức năng.</p>}</div><small>Esc để đóng</small></div></div>}
  </div></>;
}
