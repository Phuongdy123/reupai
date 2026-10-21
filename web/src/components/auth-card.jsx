"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { sendFeedback } from "./feedback-provider";

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
          options: { data: { display_name: name.trim(), username: normalizedUsername }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (authError) throw authError;
        setNotice("Kiểm tra email để xác minh tài khoản. Sau đó đăng nhập và chờ quản trị viên cấp quyền.");
      } else {
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email, password }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Tên đăng nhập, email hoặc mật khẩu không đúng."); }
        const requestedPath = new URLSearchParams(window.location.search).get("next");
        router.replace(requestedPath?.startsWith("/") ? requestedPath : "/app"); router.refresh();
      }
    } catch (caught) { setError(caught.message || "Không thể hoàn tất yêu cầu."); }
    finally { setBusy(false); }
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const next = requestedPath?.startsWith("/") ? requestedPath : "/app";
      const redirectTo = new URL(`/auth/callback?next=${encodeURIComponent(next)}`, window.location.origin).toString();
      const { data, error: authError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (authError) throw authError;
      if (!data?.url) throw new Error("Không thể mở trang đăng nhập Google.");
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught.message || "Không thể đăng nhập Google lúc này.");
      setBusy(false);
    }
  }

  return <main className="account-shell"><section className="account-card"><Link href="/" className="account-brand"><span>R</span><strong>Reup AI</strong></Link><p className="eyebrow">{signUp ? "REQUEST ACCESS" : "WELCOME BACK"}</p><h1>{signUp ? "Tạo tài khoản" : "Đăng nhập"}</h1><p className="account-subtitle">{signUp ? "Tài khoản mới cần được quản trị viên phê duyệt trước khi dùng workspace." : "Dùng tên đăng nhập, email hoặc Google để vào Reup AI Workspace."}</p>{!isSupabaseConfigured() ? <AuthUnavailable /> : <><button className="google-sign-in" type="button" onClick={signInWithGoogle} disabled={busy}><span aria-hidden="true">G</span>{busy ? "Đang mở Google…" : "Tiếp tục với Google"}</button><div className="auth-divider"><span>hoặc dùng tài khoản Reup AI</span></div><form onSubmit={submit} className="account-form">{signUp && <><label>Họ tên<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength="100" /></label><label>Tên đăng nhập<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength="3" maxLength="32" placeholder="vi-du: phuong2910" /></label></>}<label>{signUp ? "Email" : "Tên đăng nhập hoặc email"}<input value={email} onChange={(event) => setEmail(event.target.value)} type={signUp ? "email" : "text"} autoComplete={signUp ? "email" : "username"} required /></label><label>Mật khẩu<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={signUp ? "new-password" : "current-password"} required minLength="8" /></label>{error && <p className="account-notice error">{error}</p>}{notice && <p className="account-notice success">{notice}</p>}<button className="button-primary account-submit" disabled={busy}>{busy ? "Đang xử lý…" : signUp ? "Đăng ký" : "Đăng nhập"}</button></form></>}<p className="account-switch">{signUp ? "Đã có tài khoản?" : "Chưa có tài khoản?"} <Link href={signUp ? "/sign-in" : "/sign-up"}>{signUp ? "Đăng nhập" : "Đăng ký"}</Link></p></section></main>;
}
