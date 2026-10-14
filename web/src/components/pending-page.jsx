"use client";

import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";

export function PendingPage() {
  const router = useRouter();
  async function signOut() {
    if (isSupabaseConfigured()) await createClient().auth.signOut();
    router.replace("/"); router.refresh();
  }
  return <main className="account-shell"><section className="account-card pending-card"><div className="pending-mark">✓</div><p className="eyebrow">ACCESS REQUEST RECEIVED</p><h1>Đang chờ cấp quyền</h1><p className="account-subtitle">Email của bạn đã được xác minh. Quản trị viên Reup AI cần phê duyệt tài khoản trước khi bạn vào workspace.</p><button className="button-secondary account-submit" onClick={signOut}>Đăng xuất</button></section></main>;
}
