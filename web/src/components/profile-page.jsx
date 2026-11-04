"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { planName, quotaText } from "../lib/plan-display";

export function ProfilePage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [billing, setBilling] = useState(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    Promise.all([supabase.auth.getUser(), fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()), fetch("/api/billing/me", { cache: "no-store" }).then((r) => r.json())]).then(([auth, account, plan]) => {
      if (!active) return;
      setUser(auth.data.user);
      setProfile(account.profile);
      setName(account.profile?.display_name || "");
      setBilling(plan);
    }).catch(() => { if (active) setMessage("Không thể tải hồ sơ. Hãy thử lại."); });
    return () => { active = false; };
  }, []);
  async function save(event) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể lưu hồ sơ.");
      setProfile(data.profile); setMessage("Đã cập nhật tên hiển thị.");
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }
  return <div className="profile-page"><div className="profile-hero"><div className="profile-avatar">{(profile?.display_name || user?.email || "R").slice(0, 1).toUpperCase()}</div><div><small>TÀI KHOẢN REUPAI</small><h2>{profile?.display_name || "Hồ sơ của bạn"}</h2><span>{user?.email || "Đang tải…"}</span></div></div><div className="profile-grid"><section className="panel"><h3>Thông tin cá nhân</h3><form onSubmit={save}><label>Tên hiển thị<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label><label>Email<input value={user?.email || ""} disabled /></label><button className="profile-save" disabled={saving || !user}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button></form>{message && <p role="status">{message}</p>}</section><section className="panel"><h3>Gói của bạn</h3><strong>{planName(billing)}</strong><p>{quotaText(billing)}</p><Link href="/plans">Xem gói dịch vụ →</Link></section></div></div>;
}
