"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { planName, quotaText } from "../lib/plan-display";
import { BillingNotice, useBilling } from "./billing-provider";
import { PublicFooter } from "./public-footer";

const orderStatus = { pending: "Chờ thanh toán", paid: "Đã thanh toán", cancelled: "Đã hủy", failed: "Không thành công" };
const dateText = (value) => value ? new Date(value).toLocaleString("vi-VN") : "—";

function OrderParameters({ onChange }) {
  const params = useSearchParams();
  const code = params.get('order');
  const result = params.get('result');
  useEffect(() => { onChange({ code, result }); }, [code, result, onChange]);
  return null;
}

export function PlansPage() {
  const { account, error: billingError, refresh } = useBilling();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [pollRetry, setPollRetry] = useState(0);
  const [{ code: orderCode, result: orderResult }, setOrder] = useState({ code: null, result: null });
  const currentOrder = orderCode ? account?.orders?.find((order) => String(order.order_code) === orderCode) : null;
  const terminalOrderStatus = ["paid", "cancelled", "failed"].includes(currentOrder?.status) ? currentOrder.status : null;

  useEffect(() => {
    let active = true;
    const load = () => refresh({ force: true }).catch(() => {});
    if (orderCode && !terminalOrderStatus) load();
    setPollTimedOut(false);
    const cancelledAtPayOS = orderResult === "cancel";
    const alreadyFinal = Boolean(terminalOrderStatus);
    let attempts = 0;
    const timer = orderCode && !cancelledAtPayOS && !alreadyFinal
      ? window.setInterval(() => {
        attempts += 1;
        if (attempts >= 60) {
          window.clearInterval(timer);
          if (active) setPollTimedOut(true);
          return;
        }
        load();
      }, 4000)
      : null;
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [orderCode, orderResult, terminalOrderStatus, pollRetry, refresh]);

  async function checkout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Chưa tạo được thanh toán.");
      const checkoutUrl = new URL(value.checkoutUrl);
      if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "pay.payos.vn") throw new Error("Liên kết thanh toán không hợp lệ.");
      window.location.assign(checkoutUrl.toString());
    } catch (caught) { setError(caught.message); setBusy(false); }
  }

  const paidOrder = currentOrder?.status === "paid";
  const cancelledOrder = orderResult === "cancel" || currentOrder?.status === "cancelled";
  const failedOrder = currentOrder?.status === "failed";
  const waitingForOrder = Boolean(orderCode && !paidOrder && !cancelledOrder && !failedOrder);
  return <main className="plans-page">
    <Suspense fallback={null}><OrderParameters onChange={setOrder} /></Suspense>
    <header className="plans-nav"><Link href="/" className="plans-brand">Reup<span>AI</span></Link><Link href="/app">Vào workspace →</Link></header>
    <div className="plans-content">
      <p className="plans-eyebrow">GÓI DỊCH VỤ REUPAI</p>
      <h1>Chọn nhịp sáng tạo của bạn.</h1>
      <p className="plans-intro">{account?.configured ? "Bắt đầu với 3 video hoàn tất miễn phí. Khi hết lượt, nâng cấp Pro hoặc liên hệ quản trị viên." : "Khám phá gói Free và Pro đang được chuẩn bị cho ReupAI."}</p>
      {account?.configured === false && <div className="plans-banner" role="status">Hệ thống lượt xử lý đang được thiết lập.</div>}
      {account?.configured && !account?.paymentsEnabled && <div className="plans-banner" role="status">Gói Free đã hoạt động. Thanh toán Pro đang được cấu hình; bạn có thể liên hệ quản trị viên để được hỗ trợ lượt.</div>}
      {paidOrder && <div className="plans-banner success" role="status">Thanh toán đã được xác nhận. Gói Pro của bạn đã được kích hoạt.</div>}
      {cancelledOrder && <div className="plans-banner" role="status">Đơn {orderCode} đã được hủy. Gói Pro chưa được kích hoạt; bạn có thể tạo thanh toán mới bất cứ lúc nào.</div>}
      {failedOrder && <div className="plans-banner error" role="alert">Đơn {orderCode} không hoàn tất. Gói Pro chưa được kích hoạt; hãy thử thanh toán lại hoặc liên hệ hỗ trợ kèm mã đơn.</div>}
      {waitingForOrder && !pollTimedOut && <div className="plans-banner" role="status">Đang chờ payOS xác nhận đơn {orderCode}. Gói Pro chỉ được kích hoạt sau khi giao dịch được xác nhận.</div>}
      {waitingForOrder && pollTimedOut && <div className="plans-banner" role="status"><span>Chưa nhận được xác nhận cho đơn {orderCode}. Nếu bạn đã thanh toán, kiểm tra lại trạng thái hoặc liên hệ hỗ trợ kèm mã đơn.</span><button className="plans-check-order" type="button" onClick={() => setPollRetry((value) => value + 1)}>Kiểm tra lại</button></div>}
      {error && <div className="plans-banner error" role="alert">{error}</div>}
      <BillingNotice error={billingError} refresh={refresh} />
      <div className="plans-grid">
        <article className="plans-card"><div className="plans-card-top"><span className="plans-mark">01 / KHỞI ĐẦU</span><h2>Free</h2><p>Thử toàn bộ quy trình với video của bạn.</p></div><div className="plans-price"><strong>0đ</strong><span>3 video hoàn tất</span></div><ul><li>Vietsub và lồng tiếng AI</li><li>Tùy chỉnh, xem và tải thành phẩm</li><li>Lỗi hoặc hủy job không trừ lượt</li><li>File video lưu trên máy của bạn</li></ul><Link className="plans-button secondary" href="/sign-up">Bắt đầu miễn phí →</Link></article>
        <article className="plans-card pro"><div className="plans-card-top"><span className="plans-mark">02 / SÁNG TẠO KHÔNG NGẮT QUÃNG</span><h2>Pro <em>Đầy đủ tính năng</em></h2><p>Tiếp tục xử lý video sau giai đoạn dùng thử.</p></div><div className="plans-price"><strong>{account?.proPrice != null ? `${Number(account.proPrice).toLocaleString("vi-VN")}đ` : "—"}</strong><span>/ 30 ngày</span></div>{Number(account?.proPrice) === 5000 && <p className="plans-test-price">GIÁ TEST NỘI BỘ · GIAO DỊCH VẪN LÀ TIỀN THẬT</p>}<ul><li>Toàn bộ tính năng Vietsub và Voice</li><li>Không giới hạn theo số lượt Free của ReupAI</li><li>Quản lý nguồn, lịch sử và thành phẩm</li><li>Không tự gia hạn; muốn tiếp tục, bạn chủ động thanh toán kỳ mới</li></ul><button className="plans-button primary" type="button" onClick={checkout} disabled={busy || !!billingError || !account?.paymentsEnabled || !account?.authenticated}>{busy ? "Đang mở thanh toán…" : account?.paymentsEnabled ? "Nâng cấp Pro →" : "Thanh toán đang được thiết lập"}</button></article>
      </div>
      {account?.authenticated && account?.configured && <p className="plans-account">Gói hiện tại: <strong>{planName(account)}</strong> · {quotaText(account)}</p>}
      {account && !account.authenticated && <p className="plans-account">Đăng nhập để xem lượt còn lại và thanh toán: <Link href="/sign-in?next=%2Fplans">Đăng nhập →</Link></p>}
      {account?.proUntil && <p className="plans-account">Pro có hiệu lực đến: <strong>{dateText(account.proUntil)}</strong></p>}
      {account?.authenticated && account?.orders?.length > 0 && <section className="plans-orders" aria-labelledby="plans-orders-title"><div className="plans-orders-heading"><div><span className="plans-mark">TÀI KHOẢN</span><h2 id="plans-orders-title">Lịch sử thanh toán</h2></div><span>5 đơn gần nhất</span></div><div className="plans-orders-list">{account.orders.map((order) => <article className="plans-order-row" key={order.order_code}><div><strong>Đơn #{order.order_code}</strong><small>{dateText(order.created_at)}</small></div><strong>{Number(order.amount || 0).toLocaleString("vi-VN")}đ</strong><span className={`plans-order-status ${order.status}`}>{orderStatus[order.status] || order.status}</span>{order.status === "paid" && <small>Thanh toán: {dateText(order.paid_at)}</small>}</article>)}</div></section>}
      <p className="plans-footnote">Gói Pro không tự gia hạn. Phí hoặc giới hạn Google Cloud Gemini do Google quản lý riêng theo project bạn sử dụng, không nằm trong giá ReupAI.</p>
      <p className="plans-footnote">Cần hỗ trợ thanh toán? Gửi email tới <a href="mailto:phuongndps39487@gmail.com?subject=Ho%20tro%20thanh%20toan%20ReupAI">phuongndps39487@gmail.com</a> và ghi mã đơn hàng để được đối soát.</p>
    </div>
    <PublicFooter />
  </main>;
}
