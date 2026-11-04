import { createHash, createHmac } from "node:crypto";
import { createAdminSupabaseClient, createServerSupabaseClient } from "./supabase/server";
import { verifyPayosWebhook as verifyWebhookWithKey } from "./payos-signature.mjs";

export const PRO_PRICE_VND = Math.max(1000, Math.floor(Number(process.env.PRO_PRICE_VND) || 149000));
export const FREE_COMPLETED_LIMIT = 3;
export const PRO_DAYS = 30;

export function quotaConfigured() {
  return Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function paymentSecretsConfigured() {
  return Boolean(process.env.PAYOS_CLIENT_ID && process.env.PAYOS_API_KEY && process.env.PAYOS_CHECKSUM_KEY)
    && quotaConfigured();
}

export function paymentConfigured() {
  return process.env.BILLING_ENABLED === "true" && paymentSecretsConfigured();
}

// Kept for existing quota endpoints and Local Engine compatibility.
export function billingConfigured() {
  return quotaConfigured();
}

export async function billingUser() {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const admin = createAdminSupabaseClient();
  const { data: profile, error: profileError } = await admin.from("profiles").select("status,role,email").eq("id", user.id).maybeSingle();
  if (profileError || profile?.status !== "approved") return null;
  return { user, profile, admin };
}

export function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyPayosWebhook(payload) {
  return verifyWebhookWithKey(payload, process.env.PAYOS_CHECKSUM_KEY);
}

function merchantHeaders() {
  return { "Content-Type": "application/json", "x-client-id": process.env.PAYOS_CLIENT_ID, "x-api-key": process.env.PAYOS_API_KEY };
}

export async function createPayosLink({ orderCode, returnUrl, cancelUrl }) {
  if (!paymentConfigured()) throw new Error("Thanh toán chưa được cấu hình.");
  const payload = {
    orderCode,
    amount: PRO_PRICE_VND,
    description: "REUP PRO",
    returnUrl,
    cancelUrl,
    expiredAt: Math.floor(Date.now() / 1000) + 15 * 60,
    items: [{ name: `ReupAI Pro ${PRO_DAYS} ngay`, quantity: 1, price: PRO_PRICE_VND }],
  };
  payload.signature = createHmac("sha256", process.env.PAYOS_CHECKSUM_KEY)
    .update(`amount=${payload.amount}&cancelUrl=${cancelUrl}&description=${payload.description}&orderCode=${orderCode}&returnUrl=${returnUrl}`)
    .digest("hex");
  const response = await fetch("https://api-merchant.payos.vn/v2/payment-requests", {
    method: "POST", headers: merchantHeaders(), body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.code !== "00" || !result.data?.checkoutUrl) throw new Error("payOS chưa tạo được link thanh toán. Vui lòng thử lại.");
  const checkoutUrl = new URL(result.data.checkoutUrl);
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "pay.payos.vn") throw new Error("payOS trả về link thanh toán không hợp lệ.");
  return { checkoutUrl: checkoutUrl.toString(), paymentLinkId: String(result.data.paymentLinkId || "") };
}
