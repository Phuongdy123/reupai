import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    facebook: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
    redirectUri: `${origin}/api/social/oauth/callback`,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
