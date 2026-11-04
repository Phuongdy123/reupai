import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { billingUser, createPayosLink, paymentConfigured, PRO_PRICE_VND } from "../../../../src/lib/billing";

export async function POST() {
  if (!paymentConfigured()) return NextResponse.json({ error: "Thanh toán Pro đang được cấu hình. Vui lòng quay lại sau." }, { status: 503 });
  try {
    const context = await billingUser();
    if (!context) return NextResponse.json({ error: "Hãy đăng nhập tài khoản đã được duyệt." }, { status: 401 });
    const code = Date.now() * 1000 + randomInt(1000);
    const siteUrl = new URL(process.env.BILLING_SITE_URL || "https://www.reupai.cloud");
    if (siteUrl.protocol !== "https:") throw new Error("Địa chỉ thanh toán chưa hợp lệ.");
    const returnUrl = new URL(`/plans?order=${code}&result=return`, siteUrl).toString();
    const cancelUrl = new URL(`/plans?order=${code}&result=cancel`, siteUrl).toString();
    const { error: insertError } = await context.admin.from("billing_orders").insert({ order_code: code, user_id: context.user.id, amount: PRO_PRICE_VND, status: "pending" });
    if (insertError) throw insertError;
    try {
      const link = await createPayosLink({ orderCode: code, returnUrl, cancelUrl });
      const { error: updateError } = await context.admin.from("billing_orders").update({ checkout_url: link.checkoutUrl, payment_link_id: link.paymentLinkId, updated_at: new Date().toISOString() }).eq("order_code", code);
      if (updateError) throw updateError;
      return NextResponse.json({ orderCode: code, checkoutUrl: link.checkoutUrl });
    } catch (error) {
      await context.admin.from("billing_orders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("order_code", code);
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error.message || "Chưa tạo được đơn thanh toán." }, { status: 503 });
  }
}
