"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import "../styles/support-widget.css";

const QUICK_PROMPTS = [
  "Cách bật Boost GPU?",
  "Lưu & xử lý Series 3/7?",
  "Lỗi kết nối Local Engine?",
  "YouTube & Shorts Studio",
  "Gặp Admin hỗ trợ",
];

function getBotReply(text) {
  const q = String(text || "").toLowerCase();
  if (q.includes("gpu") || q.includes("tốc độ") || q.includes("nhanh")) {
    return "Để tăng tốc xử lý tối đa, bạn tích vào ô **Boost GPU** ngay trên thanh **Nguồn video**, trong bảng **Thiết lập video**, hoặc ở **YouTube/Shorts Studio**. Khi bật, hệ thống sẽ dùng CUDA cho Whisper & PaddleOCR, NVENC/NVDEC render và TTS song song.";
  }
  if (q.includes("series") || q.includes("3/7") || q.includes("tập") || q.includes("collection")) {
    return "Bạn vào mục **Series** → chọn một Series → chọn **Thứ tự** (Từ tập 1 → cuối hoặc Ngày đăng cũ → mới), chỉnh **1 cấu hình chuẩn**, tích chọn các tập rồi bấm **Xử lý hàng loạt**. Sau đó vào **Collections** để theo dõi tiến độ (vd `3/7`) và bấm **Xử lý tiếp** bất cứ lúc nào.";
  }
  if (q.includes("engine") || q.includes("kết nối") || q.includes("chưa kết nối")) {
    return "Nếu báo **Chưa kết nối Local Engine**, bạn hãy mở ứng dụng **ReupAI Desktop** trên máy, đợi vài giây rồi bấm nút **Thử lại / Kết nối ReupAI** trên thanh trên cùng. Nếu vẫn không nhận, hãy gửi Ticket để Admin kiểm tra giúp bạn.";
  }
  if (q.includes("studio") || q.includes("youtube") || q.includes("shorts") || q.includes("tiktok")) {
    return "Mục **STUDIO CHUYÊN NGHIỆP** nằm ngay dưới **Nguồn video** ở thanh bên trái: **YouTube Studio** lọc video ngang 16:9 & dài, còn **Shorts Studio** lọc video ngắn/dọc 9:16 kèm preset Pro 1 chạm và tạo Hook/Hashtag.";
  }
  if (q.includes("admin") || q.includes("hỗ trợ") || q.includes("ticket") || q.includes("gặp")) {
    return "Bạn có thể chuyển sang tab **Ticket · Chờ Admin** ngay bên cạnh để gửi câu hỏi hoặc báo lỗi trực tiếp cho Admin. Khi Admin trả lời, phản hồi sẽ hiện ngay trong danh sách Ticket của bạn!";
  }
  return "Mình đã ghi nhận câu hỏi của bạn! Nếu bot chưa trả lời đúng ý, bạn bấm nút **Gửi Ticket cho Admin** bên dưới để Admin kiểm tra và giải quyết trực tiếp cho bạn nhé.";
}

function formatTicketStatus(status) {
  if (status === "resolved") return { label: "Admin đã giải quyết", cls: "is-resolved" };
  if (status === "read") return { label: "Admin đang xử lý", cls: "is-read" };
  return { label: "Đang chờ Admin", cls: "is-new" };
}

function makeUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function SupportChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const [tab, setTab] = useState("bot");
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "bot",
      text: "Chào bạn! Mình là Bot hỗ trợ ReupAI. Bạn cần hỏi nhanh về tính năng hay muốn tạo Ticket gửi Admin giải quyết?",
    },
  ]);
  const [chatInput, setChatInput] = useState("");

  // Ticket state
  const [category, setCategory] = useState("other");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState("");
  const [ticketNotice, setTicketNotice] = useState("");
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  const loadMyTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const res = await fetch("/api/feedback", { cache: "no-store" });
      if (!res.ok) {
        setTickets([]);
        return;
      }
      const data = await res.json();
      setTickets(data.items || []);
    } catch {
      // ignore if guest/offline
    } finally {
      setLoadingTickets(false);
    }
  }, []);

  useEffect(() => {
    if (open && tab === "ticket") {
      loadMyTickets();
    }
  }, [open, tab, loadMyTickets]);

  const sendBotQuestion = (text) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    const userMsg = { id: `u-${Date.now()}`, role: "user", text: clean };
    const botMsg = { id: `b-${Date.now() + 1}`, role: "bot", text: getBotReply(clean) };
    setMessages((prev) => [...prev, userMsg, botMsg]);
    setChatInput("");
  };

  const escalateToTicket = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser && !subject.trim()) {
      setSubject(lastUser.text.slice(0, 80));
    }
    setTab("ticket");
  };

  const submitTicket = async (event) => {
    event.preventDefault();
    setTicketError("");
    setTicketNotice("");
    if (subject.trim().length < 3) {
      setTicketError("Tiêu đề cần ít nhất 3 ký tự.");
      return;
    }
    if (message.trim().length < 10) {
      setTicketError("Nội dung thắc mắc cần ít nhất 10 ký tự.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          message: message.trim(),
          details: `Trang hiện tại: ${pathname || "/"}`,
          requestId: makeUuid(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Chưa gửi được Ticket. Hãy đăng nhập trước nhé.");
      }
      setSubject("");
      setMessage("");
      setTicketNotice("Đã gửi Ticket! Admin sẽ kiểm tra và phản hồi sớm nhất.");
      await loadMyTickets();
    } catch (err) {
      setTicketError(err.message || "Không thể gửi Ticket.");
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = tickets.filter((t) => t.status !== "resolved").length;

  return (
    <div className="reupai-support-root">
      {open && (
        <section className="reupai-support-panel" role="dialog" aria-label="Hỗ trợ & Ticket Admin">
          <header className="reupai-support-head">
            <div>
              <strong>Hỗ trợ ReupAI</strong>
              <small>Bot giải đáp nhanh · Ticket gửi Admin</small>
            </div>
            <button
              type="button"
              className="reupai-support-close"
              aria-label="Đóng hộp hỗ trợ"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="reupai-support-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "bot"}
              className={tab === "bot" ? "is-active" : ""}
              onClick={() => setTab("bot")}
            >
              <Icon name="spark" size={14} />
              Bot Hỗ Trợ
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "ticket"}
              className={tab === "ticket" ? "is-active" : ""}
              onClick={() => setTab("ticket")}
            >
              <Icon name="mail" size={14} />
              Ticket · Chờ Admin
            </button>
          </div>

          {tab === "bot" ? (
            <div className="reupai-support-body">
              <div className="reupai-support-thread">
                {messages.map((item) => (
                  <div key={item.id} className={`reupai-support-msg is-${item.role}`}>
                    <p>{item.text}</p>
                  </div>
                ))}
              </div>
              <div className="reupai-support-chips">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="reupai-support-chip"
                    onClick={() => sendBotQuestion(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <form
                className="reupai-support-chat-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendBotQuestion(chatInput);
                }}
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Nhập thắc mắc của bạn…"
                  aria-label="Nhập câu hỏi cho bot"
                />
                <button type="submit" className="btn primary">Gửi</button>
              </form>
              <button
                type="button"
                className="reupai-support-escalate"
                onClick={escalateToTicket}
              >
                Cần Admin hỗ trợ trực tiếp? Tạo Ticket ngay →
              </button>
            </div>
          ) : (
            <div className="reupai-support-body">
              <form className="reupai-ticket-form" onSubmit={submitTicket}>
                <div className="reupai-ticket-row">
                  <select
                    aria-label="Loại ticket"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="other">Thắc mắc / Hỗ trợ</option>
                    <option value="bug">Báo lỗi hệ thống</option>
                    <option value="idea">Góp ý tính năng</option>
                  </select>
                  <input
                    aria-label="Tiêu đề ticket"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Tiêu đề ngắn gọn (vd: Lỗi xuất video)…"
                    maxLength={120}
                  />
                </div>
                <textarea
                  aria-label="Nội dung thắc mắc"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Mô tả chi tiết vấn đề để Admin kiểm tra và giải quyết nhanh…"
                  rows={3}
                  maxLength={4000}
                />
                {ticketError && <p className="reupai-ticket-error" role="alert">{ticketError}</p>}
                {ticketNotice && <p className="reupai-ticket-notice" role="status">{ticketNotice}</p>}
                <button type="submit" className="btn primary" disabled={submitting}>
                  {submitting ? "Đang gửi Ticket…" : "Gửi Ticket chờ Admin xử lý"}
                </button>
              </form>

              <div className="reupai-ticket-list-head">
                <strong>Ticket của bạn</strong>
                <button type="button" className="reupai-ticket-refresh" onClick={loadMyTickets} disabled={loadingTickets}>
                  {loadingTickets ? "Đang tải…" : "Làm mới"}
                </button>
              </div>
              <div className="reupai-ticket-list">
                {!tickets.length ? (
                  <p className="reupai-ticket-empty">
                    {loadingTickets ? "Đang tải danh sách ticket…" : "Chưa có ticket nào. Gửi ticket ở trên để Admin hỗ trợ."}
                  </p>
                ) : (
                  tickets.map((t) => {
                    const st = formatTicketStatus(t.status);
                    return (
                      <article className="reupai-ticket-item" key={t.id}>
                        <div className="reupai-ticket-item-top">
                          <span className={`reupai-ticket-badge ${st.cls}`}>{st.label}</span>
                          <time>{new Date(t.createdAt).toLocaleDateString("vi-VN")}</time>
                        </div>
                        <strong>{t.subject}</strong>
                        <p>{t.message}</p>
                        {t.adminReply && (
                          <div className="reupai-ticket-reply">
                            <strong>Admin trả lời:</strong> {t.adminReply}
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        className="reupai-support-launcher"
        aria-label="Hỗ trợ & Ticket"
        title="Hỗ trợ & Ticket"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? "close" : "chat"} size={24} />
        {pendingCount > 0 && <em className="reupai-support-count">{pendingCount}</em>}
      </button>
    </div>
  );
}
