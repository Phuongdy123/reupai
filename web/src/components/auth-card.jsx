"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { queueGeminiSetup } from "../lib/gemini-onboarding";
import { sendFeedback } from "./feedback-provider";
import { Icon } from "./icon";

function destinationPath() {
  const requestedPath = new URLSearchParams(window.location.search).get("next");
  return requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/app";
}

async function beginWebGoogleLogin(next) {
  const redirectTo = new URL(`/auth/callback?next=${encodeURIComponent(next)}`, window.location.origin).toString();
  const { data, error } = await createClient().auth.signInWithOAuth({
    provider: "google", options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Không thể mở trang đăng nhập Google.");
  queueGeminiSetup(window.localStorage);
  window.location.assign(data.url);
}

function AuthUnavailable() {
  return <p className="account-notice error">Cổng tài khoản chưa được cấu hình. Quản trị viên cần thêm biến môi trường Supabase trên Vercel trước khi mở đăng ký.</p>;
}

export function AuthCard({ mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [signupCreated, setSignupCreated] = useState(false);
  const router = useRouter();
  const signUp = mode === "sign-up";
  useEffect(() => { if (error) sendFeedback("error", error); }, [error]);

  async function submit(event) {
    event.preventDefault();
    if (!isSupabaseConfigured() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const supabase = createClient();
      if (signUp) {
        const normalizedUsername = username.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(normalizedUsername)) throw new Error("Tên đăng nhập gồm 3–32 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.");
        const { data, error: authError } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: name.trim(), username: normalizedUsername }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/app?onboarding=1")}` },
        });
        if (authError) throw authError;
        queueGeminiSetup(window.localStorage);
        setSignupCreated(true);
        setNotice("Tài khoản đã được tạo. Hãy kiểm tra email để xác minh, sau đó đăng nhập ReupAI.");
        if (data?.session) { router.replace(destinationPath()); router.refresh(); }
      } else {
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email, password }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Tên đăng nhập, email hoặc mật khẩu không đúng."); }
        const destination = destinationPath();
        router.replace(destination); router.refresh();
      }
    } catch (caught) { setError(caught.message || "Không thể hoàn tất yêu cầu."); }
    finally { setBusy(false); }
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await beginWebGoogleLogin(destinationPath()); }
    catch (caught) { setError(caught.message || "Không thể đăng nhập Google lúc này."); setBusy(false); }
  }

  return <main className="account-shell auth-shell">
    <section className="account-card auth-card" aria-labelledby="auth-title">
      <Link href="/" className="auth-home" aria-label="ReupAI - Trang chủ">Reup<span>AI</span></Link>
      <div className="auth-intro">
        <p className="auth-eyebrow">{signUp ? "BẮT ĐẦU CÙNG REUPAI" : "REUPAI WORKSPACE"}</p>
        <h1 id="auth-title">{signUp ? <>Tạo tài khoản <em>mới</em></> : <>Chào mừng <em>trở lại</em></>}</h1>
        <p>{signUp ? "Tạo tài khoản để quản lý và xử lý video trong không gian của bạn." : "Đăng nhập để tiếp tục hành trình tạo video đỉnh cao với ReupAI."}</p>
      </div>
      <div className="auth-tabs" aria-label="Chọn cách truy cập">
        <Link href="/sign-in" className={!signUp ? "active" : ""} aria-current={!signUp ? "page" : undefined}>Đăng nhập</Link>
        <Link href="/sign-up" className={signUp ? "active" : ""} aria-current={signUp ? "page" : undefined}>Đăng ký</Link>
      </div>
      {signUp && <div className="auth-gemini-note"><Icon name="spark" size={18} /><p><strong>Tạo tài khoản trước.</strong> Bạn có thể đăng ký mà chưa cài phần mềm. Sau khi đăng nhập, ReupAI sẽ hướng dẫn cài Local Engine để tải và xử lý video trên máy.</p></div>}
      {!isSupabaseConfigured() ? <AuthUnavailable /> : <>
        <form onSubmit={submit} className="account-form auth-form">
          {signUp && <>
            <label className="auth-field"><span className="auth-label">Họ tên</span><span className="auth-input-wrap"><Icon name="user" size={18} /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength="100" placeholder="Họ tên của bạn" /></span></label>
            <label className="auth-field"><span className="auth-label">Tên đăng nhập</span><span className="auth-input-wrap"><Icon name="user" size={18} /><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength="3" maxLength="32" placeholder="Tên đăng nhập" /></span></label>
          </>}
          <label className="auth-field"><span className="auth-label">{signUp ? "Email" : "Tên đăng nhập hoặc email"}</span><span className="auth-input-wrap"><Icon name="mail" size={18} /><input value={email} onChange={(event) => setEmail(event.target.value)} type={signUp ? "email" : "text"} autoComplete={signUp ? "email" : "username"} required placeholder={signUp ? "Email của bạn" : "Email hoặc tên đăng nhập"} /></span></label>
          <label className="auth-field"><span className="auth-label">Mật khẩu</span><span className="auth-input-wrap"><Icon name="lock" size={18} /><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete={signUp ? "new-password" : "current-password"} required minLength="8" placeholder="Mật khẩu" /><button className="auth-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}><Icon name={showPassword ? "eyeOff" : "eye"} size={18} /></button></span></label>
          {error && <p className="account-notice error" role="alert">{error}</p>}
          {notice && <p className="account-notice success" role="status">{notice}</p>}
          <button className="button-primary account-submit" disabled={busy || signupCreated}>{busy ? "Đang xử lý…" : signUp ? signupCreated ? "Đã gửi đăng ký" : "Tạo tài khoản" : "Đăng nhập"}<span aria-hidden="true">→</span></button>
        </form>
        {signUp && signupCreated && <div className="auth-gemini-progress"><strong>Bước tiếp theo</strong><p>Xác minh email rồi đăng nhập. Bạn sẽ được hướng dẫn cài Local Engine và kết nối Google cho Gemini trong workspace.</p><Link href="/sign-in">Đến trang đăng nhập →</Link></div>}
        <div className="auth-divider"><span>hoặc tiếp tục với</span></div>
        <button className="google-sign-in" type="button" onClick={signInWithGoogle} disabled={busy}><span aria-hidden="true">G</span>{busy ? "Đang chờ Google…" : signUp ? "Đăng ký với Google" : "Tiếp tục với Google"}</button>
        <p className="auth-google-hint">Đăng nhập Google trực tiếp trên web. Cài Local Engine và cấp quyền Gemini sau khi đăng nhập, trước khi xử lý video.</p>
      </>}
      <p className="account-switch">{signUp ? "Đã có tài khoản?" : "Chưa có tài khoản?"} <Link href={signUp ? "/sign-in" : "/sign-up"}>{signUp ? "Đăng nhập" : "Đăng ký ngay"}</Link></p>
    </section>
    <footer className="auth-page-footer" aria-label="Thông tin website">
      <span>© {new Date().getFullYear()} ReupAI</span>
      <nav aria-label="Liên kết website">
        <Link href="/">Trang chủ</Link>
        <Link href="/giai-phap">Giải pháp</Link>
        <Link href="/plans">Gói dịch vụ</Link>
        <Link href="/privacy">Quyền riêng tư</Link>
        <Link href="/terms">Điều khoản</Link>
      </nav>
    </footer>
  </main>;
}
