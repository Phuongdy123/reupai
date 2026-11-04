import { NextResponse } from "next/server";
import { paymentSecretsConfigured, PRO_PRICE_VND, verifyPayosWebhook } from "../../../../src/lib/billing";
import { createAdminSupabaseClient } from "../../../../src/lib/supabase/server";

export async function POST(request) {
  // payOS sends a signed sample payload while confirming the webhook URL.
  // Accept verification as soon as the private keys exist, while checkout can
  // remain disabled through BILLING_ENABLED=false until the merchant is ready.
  if (!paymentSecretsConfigured()) return NextResponse.json({ error: "Billing unavailable" }, { status: 503 });
  let payload;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  let signatureValid = false;
  try { signatureValid = verifyPayosWebhook(payload); } catch { /* Treat malformed or incomplete test payloads as invalid. */ }
  if (!signatureValid) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  if (payload.code !== "00" || payload.success !== true || payload.data?.code !== "00") return NextResponse.json({ ok: true });
  const data = payload.data;
  const code = Number(data.orderCode);
  if (!Number.isSafeInteger(code) || Number(data.amount) !== PRO_PRICE_VND || data.currency !== "VND") return NextResponse.json({ error: "Invalid payment" }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const { data: order, error: orderError } = await admin.from("billing_orders").select("order_code,amount,status,payment_link_id").eq("order_code", code).maybeSingle();
  if (orderError) return NextResponse.json({ error: "Order lookup failed" }, { status: 503 });
  // payOS posts a signed sample webhook while its URL is being confirmed.
  if (!order) return NextResponse.json({ ok: true });
  if (order.amount !== PRO_PRICE_VND || (order.payment_link_id && order.payment_link_id !== data.paymentLinkId)) return NextResponse.json({ error: "Payment mismatch" }, { status: 400 });
  const { data: applied, error: applyError } = await admin.rpc("billing_apply_paid_order", { p_order_code: code });
  if (applyError || !applied?.ok) return NextResponse.json({ error: "Could not apply payment" }, { status: 503 });
  return NextResponse.json({ ok: true });
}
