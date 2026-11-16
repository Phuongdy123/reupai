import crypto from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (provider !== "facebook" && provider !== "tiktok") {
    return NextResponse.json({ error: "Nền tảng không hợp lệ." }, { status: 400 });
  }

  const redirectUri = `${url.origin}/api/social/oauth/callback`;
  const state = `${provider}:${crypto.randomBytes(16).toString("hex")}`;
  let authUrl = "";

  if (provider === "facebook") {
    const clientId = (process.env.META_APP_ID || "").trim();
    const clientSecret = (process.env.META_APP_SECRET || "").trim();
    if (!clientId || !clientSecret) {
      return NextResponse.json({
        error: "Chưa cấu hình META_APP_ID và META_APP_SECRET trên server.",
        redirectUri,
      }, { status: 400 });
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: "pages_show_list,pages_manage_posts,pages_read_engagement",
      response_type: "code",
    });
    authUrl = `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`;
  } else {
    const clientKey = (process.env.TIKTOK_CLIENT_KEY || "").trim();
    const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || "").trim();
    if (!clientKey || !clientSecret) {
      return NextResponse.json({
        error: "Chưa cấu hình TIKTOK_CLIENT_KEY và TIKTOK_CLIENT_SECRET trên server.",
        redirectUri,
      }, { status: 400 });
    }
    const params = new URLSearchParams({
      client_key: clientKey,
      scope: "user.info.basic,video.upload",
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    });
    authUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("reupai_social_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    maxAge: 600,
    path: "/",
  });
  return response;
}
