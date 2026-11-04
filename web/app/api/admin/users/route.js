import { NextResponse } from "next/server";
import { FREE_COMPLETED_LIMIT } from "../../../../src/lib/billing";
import { createAdminSupabaseClient, createServerSupabaseClient } from "../../../../src/lib/supabase/server";

const PROFILE_FIELDS = "id,email,username,display_name,role,status,created_at,updated_at";

async function requireAdmin() {
  const current = createServerSupabaseClient();
  const { data: { user } } = await current.auth.getUser();
  if (!user) return { error: "Chưa đăng nhập", status: 401 };
  const admin = createAdminSupabaseClient();
  const { data: profile, error } = await admin.from("profiles").select("role,status").eq("id", user.id).maybeSingle();
  if (error || profile?.role !== "admin" || profile?.status !== "approved") return { error: "Không có quyền quản trị", status: 403 };
  return { admin };
}

function quotaFor(account) {
  const completed = Math.max(0, Number(account?.trial_completed || 0));
  const limit = Math.max(1, Number(account?.free_limit || FREE_COMPLETED_LIMIT));
  const unlimited = Boolean(account?.quota_unlimited);
  return { completed, limit, unlimited, remaining: unlimited ? null : Math.max(0, limit - completed) };
}

async function enrichedUser(admin, id) {
  const [{ data: profile, error: profileError }, { data: account, error: accountError }] = await Promise.all([
    admin.from("profiles").select(PROFILE_FIELDS).eq("id", id).maybeSingle(),
    admin.from("billing_accounts").select("user_id,trial_completed,free_limit,quota_unlimited,pro_until").eq("user_id", id).maybeSingle(),
  ]);
  if (profileError || accountError) throw profileError || accountError;
  return profile ? { ...profile, quota: quotaFor(account), pro_until: account?.pro_until || null } : null;
}

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { data: profiles, error: profileError } = await guard.admin.from("profiles").select(PROFILE_FIELDS).order("created_at", { ascending: false });
    if (profileError) throw profileError;
    const ids = (profiles || []).map((profile) => profile.id);
    let accounts = [];
    if (ids.length) {
      const { data, error } = await guard.admin.from("billing_accounts").select("user_id,trial_completed,free_limit,quota_unlimited,pro_until").in("user_id", ids);
      if (error) throw error;
      accounts = data || [];
    }
    const byUser = new Map(accounts.map((account) => [account.user_id, account]));
    return NextResponse.json({ users: (profiles || []).map((profile) => ({ ...profile, quota: quotaFor(byUser.get(profile.id)), pro_until: byUser.get(profile.id)?.pro_until || null })) });
  } catch (caught) {
    return NextResponse.json({ error: caught.message || "Không thể tải tài khoản." }, { status: 503 });
  }
}

export async function PATCH(request) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const body = await request.json();
    const id = String(body?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Tài khoản không hợp lệ." }, { status: 400 });
    const { data: target, error: targetError } = await guard.admin.from("profiles").select("id,role").eq("id", id).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: "Không tìm thấy tài khoản." }, { status: 404 });
    if (target.role === "admin") return NextResponse.json({ error: "Không thể sửa giới hạn hoặc trạng thái của tài khoản admin." }, { status: 403 });

    if (body.status !== undefined) {
      if (!["pending", "approved", "disabled"].includes(body.status)) return NextResponse.json({ error: "Trạng thái không hợp lệ." }, { status: 400 });
      const { error } = await guard.admin.from("profiles").update({ status: body.status }).eq("id", id);
      if (error) throw error;
    } else if (body.resetUsage === true) {
      const { error } = await guard.admin.from("billing_accounts").upsert({ user_id: id, trial_completed: 0, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
    } else if (body.quotaUnlimited === true) {
      const { error } = await guard.admin.from("billing_accounts").upsert({ user_id: id, free_limit: FREE_COMPLETED_LIMIT, quota_unlimited: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
    } else {
      const limit = Number(body.freeLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000000) return NextResponse.json({ error: "Giới hạn phải từ 1 đến 1.000.000, hoặc chọn Không giới hạn." }, { status: 400 });
      const { error } = await guard.admin.from("billing_accounts").upsert({ user_id: id, free_limit: limit, quota_unlimited: false, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
    }

    return NextResponse.json({ user: await enrichedUser(guard.admin, id) });
  } catch (caught) {
    return NextResponse.json({ error: caught.message || "Không thể cập nhật tài khoản." }, { status: 503 });
  }
}
