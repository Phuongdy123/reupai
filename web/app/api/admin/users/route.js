import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "../../../../src/lib/supabase/server";

async function requireAdmin() {
  const current = createServerSupabaseClient();
  const { data: { user } } = await current.auth.getUser();
  if (!user) return { error: "Chưa đăng nhập", status: 401 };
  const admin = createAdminSupabaseClient();
  const { data: profile, error } = await admin.from("profiles").select("role,status").eq("id", user.id).maybeSingle();
  if (error || profile?.role !== "admin" || profile?.status !== "approved") return { error: "Không có quyền quản trị", status: 403 };
  return { admin };
}

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { data, error } = await guard.admin.from("profiles").select("id,email,username,display_name,role,status,created_at,updated_at").order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ users: data || [] });
  } catch (caught) { return NextResponse.json({ error: caught.message || "Không thể tải tài khoản." }, { status: 503 }); }
}

export async function PATCH(request) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const body = await request.json();
    if (!body?.id || !["pending", "approved", "disabled"].includes(body.status)) return NextResponse.json({ error: "Dữ liệu cập nhật không hợp lệ." }, { status: 400 });
    const { data, error } = await guard.admin.from("profiles").update({ status: body.status }).eq("id", body.id).neq("role", "admin").select("id,email,username,display_name,role,status,created_at,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Không tìm thấy tài khoản hoặc không thể sửa quyền admin." }, { status: 404 });
    return NextResponse.json({ user: data });
  } catch (caught) { return NextResponse.json({ error: caught.message || "Không thể cập nhật quyền." }, { status: 503 }); }
}
