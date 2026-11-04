import { NextResponse } from "next/server";
import { billingUser, FREE_COMPLETED_LIMIT, paymentConfigured, PRO_DAYS, PRO_PRICE_VND, quotaConfigured } from "../../../../src/lib/billing";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = quotaConfigured();
  const paymentsEnabled = paymentConfigured();
  if (!configured) return NextResponse.json({ configured: false, paymentsEnabled, freeLimit: FREE_COMPLETED_LIMIT, proPrice: PRO_PRICE_VND, proDays: PRO_DAYS });
  try {
    const context = await billingUser();
    if (!context) return NextResponse.json({ configured, paymentsEnabled, authenticated: false, freeLimit: FREE_COMPLETED_LIMIT, proPrice: PRO_PRICE_VND, proDays: PRO_DAYS });
    const [{ data: account, error: accountError }, { data: orders, error: orderError }] = await Promise.all([
      context.admin.from("billing_accounts").select("trial_completed,free_limit,quota_unlimited,pro_until").eq("user_id", context.user.id).maybeSingle(),
      context.admin.from("billing_orders").select("order_code,status,amount,created_at,paid_at").eq("user_id", context.user.id).order("created_at", { ascending: false }).limit(5),
    ]);
    if (accountError || orderError) {
      if (!configured) return NextResponse.json({ configured: false, authenticated: true, freeLimit: FREE_COMPLETED_LIMIT, proPrice: PRO_PRICE_VND, proDays: PRO_DAYS });
      throw accountError || orderError;
    }
    const completed = Math.max(0, Number(account?.trial_completed || 0));
    const limit = Math.max(1, Number(account?.free_limit || FREE_COMPLETED_LIMIT));
    const proUntil = account?.pro_until || null;
    const isAdmin = context.profile?.role === "admin";
    const isPro = proUntil && Date.parse(proUntil) > Date.now();
    const unlimited = Boolean(account?.quota_unlimited) || isAdmin || isPro;
    const plan = isAdmin ? "admin" : isPro ? "pro" : "free";
    return NextResponse.json({ configured, paymentsEnabled, authenticated: true, plan, completed, limit, unlimited, remaining: unlimited ? null : Math.max(0, limit - completed), proUntil, freeLimit: FREE_COMPLETED_LIMIT, proPrice: PRO_PRICE_VND, proDays: PRO_DAYS, orders: orders || [] });
  } catch (error) {
    console.error("[billing/me] Failed to load account entitlement", { code: error?.code || "unknown", message: error?.message || "unknown" });
    return NextResponse.json({ configured: false, code: "entitlement_unavailable", error: "Máy chủ chưa đọc được quyền gói. Video chưa bị trừ lượt; vui lòng thử lại sau." }, { status: 503 });
  }
}
