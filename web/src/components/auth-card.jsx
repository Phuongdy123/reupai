"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { localEngineClient } from "../lib/local-engine-client";
import { sendFeedback } from "./feedback-provider";
import { Icon } from "./icon";

// A release can opt out, but new website builds use one Google consent for
// account login and the local Gemini connection by default.
const UNIFIED_GOOGLE_LOGIN = process.env.NEXT_PUBLIC_GOOGLE_GEMINI_LOGIN !== "false";
const GEMINI_ONBOARDING_KEY = "reupai.gemini.onboarding";

function destinationPath() {
  const requestedPath = new URLSearchParams(window.location.search).get("next");
  return requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/app";
}

async function beginWebGoogleLogin(next) {
  const redirectTo = new URL(`/auth/callback?next=${encodeURIComponent(next)}`, window.location.origin).toString();
  const { data, error } = await createClient().auth.signInWithOAuth({
    provider: "google", options: { redirectTo },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Không thể mở trang đăng nhập Google.");
  window.location.assign(data.url);
}

async function loginNonce() {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const nonceHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { nonce, nonceHash };
}

async function waitForGoogleIdentity(loginRequest) {
  const deadline = Date.now() + 305000;
  while (Date.now() < deadline) {
    const result = await localEngineClient.json("/api/gemini/oauth/login-result", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login_request: loginRequest }),
    });
    if (result.state === "ready" && result.id_token) return result.id_token;
    if (result.state !== "connecting") throw new Error(result.message || "Google chưa hoàn tất đăng nhập. Hãy thử lại.");
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  }
  throw new Error("Đã quá thời gian chờ Google. Hãy thử đăng nhập lại.");
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
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState("");
  const [showWebFallback, setShowWebFallback] = useState(false);
  const router = useRouter();
  const signUp = mode === "sign-up";
  useEffect(() => { if (error) sendFeedback("error", error); }, [error]);

  async function submit(event) {
    event.preventDefault();
    if (!isSupabaseConfigured()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const supabase = createClient();
      if (signUp) {
        const normalizedUsername = username.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(normalizedUsername)) throw new Error("Tên đăng nhập gồm 3–32 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.");
        const { error: authError } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: name.trim(), username: normalizedUsername }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/settings?onboarding=1#diagnostics")}` },
        });
        if (authError) throw authError;
        window.localStorage.setItem(GEMINI_ONBOARDING_KEY, "1");
        setSignupCreated(true);
        setNotice("Tài khoản đã được tạo. Hãy kiểm tra email để xác minh, sau đó đăng nhập ReupAI.");
        void connectGeminiAfterSignup();
      } else {
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email, password }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Tên đăng nhập, email hoặc mật khẩu không đúng."); }
        const requestedPath = new URLSearchParams(window.location.search).get("next");
        const destination = window.localStorage.getItem(GEMINI_ONBOARDING_KEY) === "1"
          ? "/settings?onboarding=1#diagnostics"
          : requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/app";
        router.replace(destination); router.refresh();
      }
    } catch (caught) { setError(caught.message || "Không thể hoàn tất yêu cầu."); }
    finally { setBusy(false); }
  }

  async function connectGeminiAfterSignup() {
    if (geminiBusy) return;
    setGeminiBusy(true); setGeminiStatus("Đang kiểm tra ReupAI Local Engine trên máy này…");
    try {
      let connected = await localEngineClient.check();
      if (!connected && ["authorization_required", "permission_denied"].includes(localEngineClient.status)) {
        connected = await localEngineClient.authorizeDirectly();
      }
      if (!connected) throw new Error("Hãy mở ReupAI Local Engine trên máy này, rồi bấm Kết nối Google cho Gemini.");
      const health = await localEngineClient.json("/api/health");
      if (!health.capabilities?.google_gemini_login) throw new Error("Hãy cập nhật Local Engine để cấp quyền Gemini bằng Google.");
      await localEngineClient.json("/api/gemini/oauth/start", { method: "POST" });
      setGeminiStatus("Google đã mở trong trình duyệt. Hãy chọn tài khoản và cấp quyền Gemini.");
      const deadline = Date.now() + 305000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        const state = await localEngineClient.json("/api/gemini/oauth");
        if (state.connected && !state.connecting) {
          const setup = state.api_setup;
          setGeminiStatus(`Đã cấp quyền Google trên máy này. ${setup?.message || "Sau khi tài khoản được duyệt, vào Cài đặt chọn Google Cloud project của bạn để kiểm tra Gemini."}`);
          return;
        }
        if (!state.connecting && state.error) throw new Error(state.error);
      }
      throw new Error("Hết thời gian chờ Google. Bấm Kết nối lại để thử lần nữa.");
    } catch (caught) {
      setGeminiStatus(caught.message || "Chưa thể kết nối Google. Bạn có thể thử lại sau.");
    } finally { setGeminiBusy(false); }
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = destinationPath();
      if (!UNIFIED_GOOGLE_LOGIN) {
        await beginWebGoogleLogin(next);
        return;
      }
      const connected = await localEngineClient.check();
      if (!connected && ["authorization_required", "permission_denied"].includes(localEngineClient.status)) {
        if (!await localEngineClient.authorizeDirectly()) throw new Error("Chưa cấp quyền cho trang ReupAI kết nối Local Engine.");
      } else if (!connected) {
        throw new Error("Hãy mở ReupAI Local Engine trên máy này rồi thử đăng nhập Google.");
      }
      const health = await localEngineClient.json("/api/health");
      if (!health.capabilities?.google_gemini_login) {
        throw new Error("Local Engine cần được cập nhật để đăng nhập Google và cấp quyền Gemini cùng một lần.");
      }
      const { nonce, nonceHash } = await loginNonce();
      setNotice("Google đang mở trong trình duyệt. Hãy chọn tài khoản và cấp quyền Gemini; trang này sẽ tự hoàn tất đăng nhập.");
      const started = await localEngineClient.json("/api/gemini/oauth/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce_hash: nonceHash }),
      });
      if (!started.login_request) throw new Error("Local Engine chưa tạo được lượt đăng nhập Google.");
      const idToken = await waitForGoogleIdentity(started.login_request);
      const { error: authError } = await createClient().auth.signInWithIdToken({
        provider: "google", token: idToken, nonce,
      });
      if (authError) {
        if (/unacceptable audience|bad id token|nonce/i.test(authError.message || "")) {
          throw new Error("Google đã cấp quyền Gemini, nhưng website chưa chấp nhận đăng nhập. Quản trị viên cần kiểm tra Desktop Client ID và nonce trong Supabase.");
        }
        throw authError;
      }
      window.localStorage.removeItem(GEMINI_ONBOARDING_KEY);
      router.replace(started.project_id ? next : "/settings#diagnostics"); router.refresh();
    } catch (caught) {
      setError(caught.message || "Không thể đăng nhập Google lúc này.");
      setNotice("");
      if (UNIFIED_GOOGLE_LOGIN) setShowWebFallback(true);
      setBusy(false);
    }
  }

  async function signInWithWebGoogle() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await beginWebGoogleLogin(destinationPath()); }
    catch (caught) { setError(caught.message || "Không thể đăng nhập Google vào website."); setBusy(false); }
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
      {signUp && <div className="auth-gemini-note"><Icon name="spark" size={18} /><p><strong>Đăng ký bằng email?</strong> Bạn vẫn cần kết nối Google và cấp quyền Gemini trên Local Engine. ReupAI sẽ mở bước kết nối ngay sau khi tạo tài khoản; mỗi khách chọn Google Cloud project của mình.</p></div>}
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
        {signUp && signupCreated && <div className="auth-gemini-progress" role="status"><strong>Quyền Gemini trên máy này</strong><p>{geminiStatus || "Đang chuẩn bị kết nối Google…"}</p><button type="button" onClick={connectGeminiAfterSignup} disabled={geminiBusy}>{geminiBusy ? "Đang chờ Google…" : "Kết nối Google cho Gemini"}</button></div>}
        <div className="auth-divider"><span>hoặc tiếp tục với</span></div>
        <button className="google-sign-in" type="button" onClick={signInWithGoogle} disabled={busy}><span aria-hidden="true">G</span>{busy ? "Đang chờ Google…" : signUp ? "Đăng ký với Google" : "Tiếp tục với Google"}</button>
        {UNIFIED_GOOGLE_LOGIN && <p className="auth-google-hint">Mở ReupAI Local Engine để đăng nhập Google và cấp quyền Gemini cùng một lần.</p>}
        {showWebFallback && <div className="account-notice"><p>Chưa thể kết nối Gemini trên máy này. Bạn có thể vào website trước, rồi kết nối trong Cài đặt.</p><button className="btn" type="button" onClick={signInWithWebGoogle} disabled={busy}>Chỉ đăng nhập website bằng Google</button></div>}
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
