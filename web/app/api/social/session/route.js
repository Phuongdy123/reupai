import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../src/lib/supabase/server";

// The Engine uses this endpoint to bind a channel to the signed-in ReupAI user.
// No Google/YouTube token is sent to the website.
export async function GET(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Hãy đăng nhập ReupAI." }, { status: 401 });
  try {
    const { data, error } = await createServerSupabaseClient().auth.getUser(token);
    if (error || !data.user) return NextResponse.json({ error: "Phiên ReupAI đã hết hạn." }, { status: 401 });
    return NextResponse.json({ userId: data.user.id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Chưa xác minh được tài khoản." }, { status: 503 });
  }
}
