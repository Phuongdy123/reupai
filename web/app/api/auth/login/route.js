import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "../../../../src/lib/supabase/server";
import { requireSupabaseConfig } from "../../../../src/lib/supabase/config";

const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch (_) { return NextResponse.json({ error: "Dữ liệu đăng nhập không hợp lệ." }, { status: 400 }); }
  const identifier = String(body?.identifier || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!identifier || !password) return NextResponse.json({ error: "Tên đăng nhập, email hoặc mật khẩu không đúng." }, { status: 401 });
  try {
    let email = identifier;
    if (!identifier.includes("@")) {
      if (!usernamePattern.test(identifier)) return NextResponse.json({ error: "Tên đăng nhập, email hoặc mật khẩu không đúng." }, { status: 401 });
      const admin = createAdminSupabaseClient();
      const { data } = await admin.from("profiles").select("email").eq("username", identifier).maybeSingle();
      if (!data?.email) return NextResponse.json({ error: "Tên đăng nhập, email hoặc mật khẩu không đúng." }, { status: 401 });
      email = data.email;
    }
    const response = NextResponse.json({ ok: true });
    const { url, key } = requireSupabaseConfig();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(values) { values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
      },
    });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return NextResponse.json({ error: "Tên đăng nhập, email hoặc mật khẩu không đúng." }, { status: 401 });
    return response;
  } catch (_) { return NextResponse.json({ error: "Không thể đăng nhập lúc này. Hãy thử lại." }, { status: 503 }); }
}
