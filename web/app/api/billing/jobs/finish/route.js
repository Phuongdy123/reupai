import { NextResponse } from "next/server";
import { billingConfigured, tokenHash } from "../../../../../src/lib/billing";
import { createAdminSupabaseClient } from "../../../../../src/lib/supabase/server";

export async function POST(request) {
  if (!billingConfigured()) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const body = await request.json();
    if (!/^[\w-]{40,60}$/.test(body.token || "") || !["completed", "failed", "cancelled"].includes(body.status)) return NextResponse.json({ ok: false }, { status: 400 });
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("billing_finish_job", { p_token_hash: tokenHash(body.token), p_status: body.status });
    if (error) throw error;
    return NextResponse.json({ ok: Boolean(data?.ok), remaining: data?.remaining }, { status: data?.ok ? 200 : 409 });
  } catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}
