"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { queueGeminiSetup } from "../lib/gemini-onboarding";
import { safeAuthPath } from "../lib/auth-navigation.mjs";
import { Icon } from "./icon";
import { PublicStarfield } from "./public-starfield";

function destinationPath() {
  return safeAuthPath(new URLSearchParams(window.location.search).get("next"), window.location.origin);
}

async function beginWebGoogleLogin(next) {
  const redirectTo = new URL(`/auth/callback?next=${encodeURIComponent(next)}`, window.location.origin).toString();
  const { data, error } = await createClient().auth.signInWithOAuth({
    provider: "google", options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Không thể mở trang đăng nhập Google. Hãy thử lại.");
  queueGeminiSetup(window.localStorage);
  window.location.assign(data.url);
}

function authErrorMessage(caught) {
  const message = caught?.message || "";
  if (/already registered|already been registered|user already exists/i.test(message)) return "Email này đã có tài khoản. Bạn có thể chuyển sang đăng nhập.";
  if (/email rate limit|too many requests|rate limit/i.test(message)) return "Bạn đã thử nhiều lần. Vui lòng chờ một chút rồi thử lại.";
  if (/invalid email|email address.*invalid/i.test(message)) return "Email chưa hợp lệ. Bạn kiểm tra lại nhé.";
  if (/password.*(weak|at least|short)/i.test(message)) return "Hãy dùng mật khẩu ít nhất 8 ký tự, kết hợp chữ và số.";
  if (/failed to fetch|network|load failed/i.test(message)) return "Chưa kết nối được đến máy chủ. Kiểm tra mạng rồi thử lại.";
  return message || "Chưa thể hoàn tất yêu cầu. Vui lòng thử lại.";
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2.1 1-3.4 1a6 6 0 0 1-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5L18.6 4A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6A6 6 0 0 1 12 5.9Z"/></svg>;
}

function AuthArtwork() {
  return <div className="auth-artwork" aria-hidden="true">
    <div className="auth-art-orbit auth-art-orbit-one" /><div className="auth-art-orbit auth-art-orbit-two" />
    <div className="auth-art-core"><span><Icon name="play" size={36} /></span></div>
    <div className="auth-art-node auth-art-node-sub"><Icon name="mail" size={16} /><span>Vietsub</span></div>
    <div className="auth-art-node auth-art-node-ai"><Icon name="spark" size={16} /><span>AI Voice</span></div>
    <span className="auth-art-dot auth-art-dot-one" /><span className="auth-art-dot auth-art-dot-two" />
  </div>;
}

export function AuthCard({ mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [signupCreated, setSignupCreated] = useState(false);
  const [nextPath, setNextPath] = useState("/app");
  const router = useRouter();
  const signUp = mode === "sign-up";
  const configured = isSupabaseConfigured();
  const busy = pending !== null;
  const suffix = nextPath === "/app" ? "" : `?next=${encodeURIComponent(nextPath)}`;
  const signInHref = `/sign-in${suffix}`;
  const signUpHref = `/sign-up${suffix}`;

  useEffect(() => {
    setNextPath(destinationPath());
    const code = new URLSearchParams(window.location.search).get("error");
    if (code === "account_not_configured") setError("Đăng nhập tạm thời chưa khả dụng. Vui lòng thử lại sau.");
    else if (code) setError("Đăng nhập chưa hoàn tất hoặc liên kết xác minh đã hết hạn. Bạn có thể thử lại với Google hoặc email.");
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!configured || busy || signupCreated) return;
    setPending("email"); setError("");
    try {
      if (signUp) {
        const normalizedUsername = username.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(normalizedUsername)) throw new Error("Tên đăng nhập cần 3–32 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.");
        const next = destinationPath();
        const confirmationNext = next === "/app" ? "/app?onboarding=1" : next;
        const { data, error: authError } = await createClient().auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: name.trim(), username: normalizedUsername }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(confirmationNext)}` },
        });
        if (authError) throw authError;
        queueGeminiSetup(window.localStorage);
        if (data?.session) { router.replace(next); router.refresh(); }
        else setSignupCreated(true);
      } else {
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email.trim(), password }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Tên đăng nhập, email hoặc mật khẩu không đúng."); }
        router.replace(destinationPath()); router.refresh();
      }
    } catch (caught) { setError(authErrorMessage(caught)); }
    finally { setPending(null); }
  }

  async function signInWithGoogle() {
    if (!configured || busy) return;
    setPending("google"); setError("");
    try { await beginWebGoogleLogin(destinationPath()); }
    catch (caught) { setError(authErrorMessage(caught)); setPending(null); }
  }

  return <main className={`account-shell auth-shell auth-premium${signUp ? " is-signup" : ""}`}>
    <PublicStarfield />
    <header className="auth-topbar">
      <Link href="/" className="auth-wordmark" aria-label="ReupAI - Trang chủ">Reup<span>AI</span><span className="auth-brand-dot" aria-hidden="true" /></Link>
      <Link href="/app" className="auth-back"><span aria-hidden="true">←</span> Về trang chủ</Link>
    </header>

    <div className="auth-layout">
      <aside className="auth-story" aria-label="Không gian sáng tạo ReupAI">
        <p className="auth-story-eyebrow"><span /> KHÔNG GIAN SÁNG TẠO</p>
        <h2>Video của bạn.<br /><span>Dấu ấn của bạn.</span></h2>
        <p className="auth-story-copy">Biến video nguồn thành câu chuyện mới với phụ đề và giọng đọc AI.</p>
        <AuthArtwork />
        <div className="auth-story-bottom"><span className="auth-story-bottom-icon"><Icon name="lock" size={16} /></span><div><strong>Sáng tạo theo cách của bạn.</strong><p>Quản lý nguồn, dự án và thành phẩm trong một không gian.</p></div></div>
        <span className="auth-story-caption">REUPAI / VIDEO WORKSPACE</span>
      </aside>

      <section className="account-card auth-card" aria-labelledby="auth-title">
        <div className="auth-tabs" aria-label="Chọn cách truy cập">
          <Link href={signInHref} className={!signUp ? "active" : ""} aria-current={!signUp ? "page" : undefined}>Đăng nhập</Link>
          <Link href={signUpHref} className={signUp ? "active" : ""} aria-current={signUp ? "page" : undefined}>Tạo tài khoản</Link>
        </div>
        <div className="auth-intro"><h1 id="auth-title">{signUp ? "Bắt đầu cùng ReupAI." : "Chào mừng trở lại."}</h1><p>{signUp ? "Một tài khoản. Không gian video của riêng bạn." : "Tiếp tục với những ý tưởng còn dang dở."}</p></div>

        {signupCreated ? <div className="auth-success" role="status">
          <span className="auth-success-icon"><Icon name="mail" size={24} /></span>
          <h2>Kiểm tra hộp thư của bạn</h2><p>Liên kết xác minh đã được gửi đến <strong>{email}</strong>. Mở email để hoàn tất đăng ký.</p>
          <Link href={signInHref} className="auth-success-link">Đến trang đăng nhập <span aria-hidden="true">→</span></Link>
          <small>Chưa thấy email? Kiểm tra cả thư mục spam.</small>
        </div> : <>
          <button className="google-sign-in" type="button" onClick={signInWithGoogle} disabled={busy || !configured} aria-busy={pending === "google"}>
            {pending === "google" ? <span className="auth-action-spinner" aria-hidden="true" /> : <GoogleMark />}{pending === "google" ? "Đang mở Google…" : "Tiếp tục với Google"}
          </button>
          <div className="auth-divider"><span>hoặc dùng email</span></div>
          {!configured && <p className="auth-config-note" role="status"><Icon name="alert" size={15} />Đăng nhập tạm thời chưa khả dụng. Vui lòng thử lại sau.</p>}
          <form onSubmit={submit} className="account-form auth-form" aria-busy={pending === "email"}>
            {signUp && <div className="auth-field-pair">
              <div className="auth-field"><label htmlFor="auth-name">Họ và tên</label><div className="auth-input-wrap"><input id="auth-name" name="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={100} disabled={busy} placeholder="Tên của bạn" /></div></div>
              <div className="auth-field"><label htmlFor="auth-username">Tên đăng nhập</label><div className="auth-input-wrap"><input id="auth-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} disabled={busy} placeholder="vd: minhnguyen" aria-describedby="auth-username-hint" /></div></div>
              <small id="auth-username-hint" className="auth-field-hint">Tên đăng nhập gồm 3–32 ký tự, không có dấu hoặc khoảng trắng.</small>
            </div>}
            <div className="auth-field"><label htmlFor="auth-email">{signUp ? "Email" : "Email hoặc tên đăng nhập"}</label><div className="auth-input-wrap"><Icon name="mail" size={16} /><input id="auth-email" name={signUp ? "email" : "identifier"} value={email} onChange={(event) => setEmail(event.target.value)} type={signUp ? "email" : "text"} autoComplete={signUp ? "email" : "username"} autoCapitalize="none" spellCheck={false} required disabled={busy} placeholder={signUp ? "ban@example.com" : "Email hoặc tên đăng nhập của bạn"} /></div></div>
            <div className="auth-field"><label htmlFor="auth-password">Mật khẩu</label><div className="auth-input-wrap"><Icon name="lock" size={16} /><input id="auth-password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete={signUp ? "new-password" : "current-password"} required minLength={signUp ? 8 : undefined} disabled={busy} placeholder={signUp ? "Tạo mật khẩu của bạn" : "Nhập mật khẩu"} aria-describedby={signUp ? "auth-password-hint" : undefined} /><button className="auth-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword}><Icon name={showPassword ? "eyeOff" : "eye"} size={17} /></button></div>{signUp && <small className="auth-field-hint" id="auth-password-hint">Ít nhất 8 ký tự. Nên kết hợp chữ, số và ký hiệu.</small>}</div>
            {error && <p className="auth-inline-error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></p>}
            <button className="account-submit" disabled={busy || !configured}>{pending === "email" ? <><span className="auth-action-spinner" aria-hidden="true" />Đang xử lý…</> : <>{signUp ? "Tạo tài khoản" : "Đăng nhập"}<span aria-hidden="true">→</span></>}</button>
          </form>
        </>}
        <div className="auth-onboarding-note"><span className="auth-onboarding-icon"><Icon name="spark" size={16} /></span><p>{signUp ? "Đăng ký trước, sẵn sàng sáng tạo sau." : "Sẵn sàng xử lý video trên máy của bạn."}<span>ReupAI sẽ hướng dẫn cài Local Engine và kết nối Gemini sau khi đăng nhập.</span></p></div>
        {signUp && <p className="auth-terms-note">Bằng việc tiếp tục, bạn đồng ý với <Link href="/terms">Điều khoản</Link> và <Link href="/privacy">Chính sách quyền riêng tư</Link>.</p>}
      </section>
    </div>
    <footer className="auth-page-footer" aria-label="Thông tin website"><span>© {new Date().getFullYear()} ReupAI</span><nav aria-label="Liên kết website"><Link href="/plans">Gói dịch vụ</Link><Link href="/privacy">Quyền riêng tư</Link><Link href="/terms">Điều khoản</Link></nav><span className="auth-footer-note"><span /> MADE FOR YOUR NEXT IDEA</span></footer>
  </main>;
}
