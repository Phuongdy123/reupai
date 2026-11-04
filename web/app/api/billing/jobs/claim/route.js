import { NextResponse } from "next/server";
import { billingConfigured, tokenHash } from "../../../../../src/lib/billing";
import { createAdminSupabaseClient } from "../../../../../src/lib/supabase/server";

export async function POST(request) {
  if (!billingConfigured()) return NextResponse.json({ allowed: false }, { status: 503 });
  try {
    const body = await request.json();
    if (!/^[\w-]{40,60}$/.test(body.token || "") || !/^[a-zA-Z0-9_-]{3,100}$/.test(body.videoId || "") || !["subtitle", "voiceover"].includes(body.mode)) return NextResponse.json({ allowed: false }, { status: 400 });
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("billing_claim_job", { p_token_hash: tokenHash(body.token), p_video_id: body.videoId, p_mode: body.mode });
    if (error) throw error;
    return NextResponse.json({ allowed: Boolean(data?.allowed) }, { status: data?.allowed ? 200 : 403 });
  } catch { return NextResponse.json({ allowed: false }, { status: 503 }); }
}
