import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient } from "../../../src/lib/supabase/server";

async function context() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { user, admin: createAdminSupabaseClient() } : null;
}
export async function GET() {
  try {
    const current = await context();
    if (!current) return NextResponse.json({ error: "Hãy đăng nhập." }, { status: 401 });
    const { data: profile, error } = await current.admin.from("profiles").select("display_name,username,status,role").eq("id", current.user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ profile });
  } catch { return NextResponse.json({ error: "Không thể tải hồ sơ." }, { status: 503 }); }
}
export async function PATCH(request) {
  try {
    const current = await context();
    if (!current) return NextResponse.json({ error: "Hãy đăng nhập." }, { status: 401 });
    const { displayName } = await request.json();
    if (typeof displayName !== "string" || !displayName.trim() || displayName.trim().length > 100) return NextResponse.json({ error: "Tên hiển thị phải có 1–100 ký tự." }, { status: 400 });
    const { data: profile, error } = await current.admin.from("profiles").update({ display_name: displayName.trim() }).eq("id", current.user.id).select("display_name,username,status,role").single();
    if (error) throw error;
    return NextResponse.json({ profile });
  } catch { return NextResponse.json({ error: "Không thể cập nhật hồ sơ." }, { status: 503 }); }
}
