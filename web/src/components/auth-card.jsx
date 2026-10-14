"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";

function AuthUnavailable() {
  return <p className="account-notice error">Cổng tài khoản chưa được cấu hình. Quản trị viên cần thêm biến môi trường Supabase trên Vercel trước khi mở đăng ký.</p>;
}

export function AuthCard({ mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const signUp = mode === "sign-up";

  async function submit(event) {
    event.preventDefault();
    if (!isSupabaseConfigured()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const supabase = createClient();
      if (signUp) {
        const { error: authError } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (authError) throw authError;
        setNotice("Kiểm tra email để xác minh tài khoản. Sau đó đăng nhập và chờ quản trị viên cấp quyền.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        const requestedPath = new URLSearchParams(window.location.search).get("next");
        router.replace(requestedPath?.startsWith("/") ? requestedPath : "/app"); router.refresh();
      }
    } catch (caught) { setError(caught.message || "Không thể hoàn tất yêu cầu."); }
    finally { setBusy(false); }
  }

  return <main className="account-shell"><section className="account-card"><Link href="/" className="account-brand"><span>R</span><strong>Reup AI</strong></Link><p className="eyebrow">{signUp ? "REQUEST ACCESS" : "WELCOME BACK"}</p><h1>{signUp ? "Tạo tài khoản" : "Đăng nhập"}</h1><p className="account-subtitle">{signUp ? "Tài khoản mới cần xác minh email và được quản trị viên phê duyệt trước khi dùng workspace." : "Đăng nhập để truy cập Reup AI Workspace."}</p>{!isSupabaseConfigured() ? <AuthUnavailable /> : <form onSubmit={submit} className="account-form">{signUp && <label>Họ tên<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength="100" /></label>}<label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label><label>Mật khẩu<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={signUp ? "new-password" : "current-password"} required minLength="8" /></label>{error && <p className="account-notice error">{error}</p>}{notice && <p className="account-notice success">{notice}</p>}<button className="button-primary account-submit" disabled={busy}>{busy ? "Đang xử lý…" : signUp ? "Đăng ký" : "Đăng nhập"}</button></form>}<p className="account-switch">{signUp ? "Đã có tài khoản?" : "Chưa có tài khoản?"} <Link href={signUp ? "/sign-in" : "/sign-up"}>{signUp ? "Đăng nhập" : "Đăng ký"}</Link></p></section></main>;
}
