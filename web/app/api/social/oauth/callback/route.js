import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function popupResultHtml(payload) {
  const safeJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  return new NextResponse(
    `<!doctype html><html><body style="font-family:sans-serif;background:#0b0d13;color:#f8fafc;display:grid;place-items:center;height:100vh;margin:0"><p>${payload.error ? "Chưa kết nối được: " + String(payload.error).replace(/</g, "&lt;") : "Đã kết nối thành công! Đang quay lại ReupAI…"}</p><script>if(window.opener){window.opener.postMessage(${safeJson},window.location.origin);}setTimeout(()=>window.close(),400);</script></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error") || "";
  const savedState = cookies().get("reupai_social_oauth_state")?.value || "";

  if (oauthError) return popupResultHtml({ type: "reupai:social-oauth", error: oauthError });
  if (!code || !state || !savedState || state !== savedState) {
    return popupResultHtml({ type: "reupai:social-oauth", error: "Phiên xác thực không hợp lệ hoặc đã hết hạn." });
  }

  const provider = state.split(":")[0];
  const redirectUri = `${url.origin}/api/social/oauth/callback`;

  try {
    if (provider === "facebook") {
      const tokenParams = new URLSearchParams({
        client_id: (process.env.META_APP_ID || "").trim(),
        client_secret: (process.env.META_APP_SECRET || "").trim(),
        redirect_uri: redirectUri,
        code,
      });
      const tokenRes = await fetch(`https://graph.facebook.com/v20.0/oauth/access_token?${tokenParams.toString()}`);
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(tokenData?.error?.message || "Không lấy được Facebook token.");
      }
      const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(tokenData.access_token)}`);
      const pagesData = await pagesRes.json();
      const pages = Array.isArray(pagesData?.data) ? pagesData.data.map((p) => ({
        id: String(p.id),
        name: String(p.name || p.id),
        token: String(p.access_token || ""),
      })).filter((p) => p.token) : [];
      if (!pages.length) {
        throw new Error("Tài khoản Facebook này chưa quản lý Fanpage nào có quyền đăng bài.");
      }
      return popupResultHtml({ type: "reupai:social-oauth", provider: "facebook", pages });
    }

    if (provider === "tiktok") {
      const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: (process.env.TIKTOK_CLIENT_KEY || "").trim(),
          client_secret: (process.env.TIKTOK_CLIENT_SECRET || "").trim(),
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }).toString(),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(tokenData?.error_description || tokenData?.error || "Không lấy được TikTok token.");
      }
      let displayName = tokenData.open_id || "Tài khoản TikTok";
      try {
        const infoRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const infoData = await infoRes.json();
        displayName = infoData?.data?.user?.display_name || displayName;
      } catch {}
      return popupResultHtml({
        type: "reupai:social-oauth",
        provider: "tiktok",
        token: String(tokenData.access_token),
        target: { id: String(tokenData.open_id || "tiktok"), name: String(displayName) },
      });
    }

    return popupResultHtml({ type: "reupai:social-oauth", error: "Nền tảng không được hỗ trợ." });
  } catch (err) {
    return popupResultHtml({ type: "reupai:social-oauth", error: err?.message || "Lỗi kết nối mạng xã hội." });
  }
}
