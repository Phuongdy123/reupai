import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { billingConfigured, billingUser, tokenHash } from "../../../../../src/lib/billing";

export async function POST(request) {
  if (!billingConfigured()) return NextResponse.json({ error: "Quyền gói chưa sẵn sàng." }, { status: 503 });
  try {
    const context = await billingUser();
    if (!context) return NextResponse.json({ error: "Hãy đăng nhập tài khoản đã được duyệt." }, { status: 401 });
    const body = await request.json();
    const jobKey = String(body.jobKey || "");
    const videoId = String(body.videoId || "");
    const mode = String(body.mode || "");
    if (!/^[a-f0-9-]{36}$/i.test(jobKey) || !/^[a-zA-Z0-9_-]{3,100}$/.test(videoId) || !["subtitle", "voiceover"].includes(mode)) {
      return NextResponse.json({ error: "Dữ liệu video không hợp lệ." }, { status: 400 });
    }
    const token = randomBytes(32).toString("base64url");
    const { data, error } = await context.admin.rpc("billing_reserve_job", { p_user_id: context.user.id, p_job_key: jobKey, p_video_id: videoId, p_mode: mode, p_token_hash: tokenHash(token) });
    if (error) throw error;
    if (!data?.allowed) {
      const limit = Math.max(1, Number(data?.limit || 3));
      return NextResponse.json({
        error: data?.reason === "trial_exhausted"
          ? `Bạn đã dùng hết ${limit} video của gói hiện tại. Nâng cấp Pro để tiếp tục.`
          : "Job này đã được tạo. Hãy tải lại trạng thái trước khi thử tiếp.",
        reason: data?.reason,
        limit,
        remaining: Math.max(0, Number(data?.remaining || 0)),
      }, { status: data?.reason === "trial_exhausted" ? 402 : 409 });
    }
    return NextResponse.json({ token, reservationId: data.id, plan: data.plan, limit: data.limit ?? null, unlimited: Boolean(data.unlimited), expiresIn: 259200 });
  } catch (error) {
    console.error("[billing/jobs/reserve] Failed to reserve a job", { code: error?.code || "unknown", message: error?.message || "unknown" });
    return NextResponse.json({ code: "reservation_unavailable", error: "Máy chủ chưa cấp được lượt xử lý. Video chưa được gửi xử lý; vui lòng thử lại sau." }, { status: 503 });
  }
}
