"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const FeedbackContext = createContext(null);

function text(value, fallback) {
  const message = String(value?.message || value || "").trim();
  return message || fallback;
}

export function FeedbackProvider({ children }) {
  const [modal, setModal] = useState(null);
  const waits = useRef(new Map());

  const showError = useCallback((message) => {
    setModal({ type: "error", message: text(message, "Không thể hoàn tất thao tác. Hãy thử lại.") });
  }, []);
  const beginWaiting = useCallback((message = "Hệ thống đang xử lý yêu cầu của bạn.", id = crypto.randomUUID()) => {
    waits.current.set(id, text(message, "Hệ thống đang xử lý yêu cầu của bạn."));
    setModal({ type: "waiting", id, message: waits.current.get(id) });
    return id;
  }, []);
  const endWaiting = useCallback((id) => {
    if (id) waits.current.delete(id);
    else waits.current.clear();
    const next = waits.current.entries().next().value;
    setModal(next ? { type: "waiting", id: next[0], message: next[1] } : null);
  }, []);

  useEffect(() => {
    const nativeAlert = window.alert;
    const onFeedback = (event) => {
      const detail = event.detail || {};
      if (detail.type === "waiting") beginWaiting(detail.message, detail.id);
      else if (detail.type === "done") endWaiting(detail.id);
      else showError(detail.message || detail.error);
    };
    window.alert = (message) => showError(message);
    window.ReupFeedback = { showError, beginWaiting, endWaiting };
    window.addEventListener("reupai:feedback", onFeedback);
    return () => {
      window.alert = nativeAlert;
      delete window.ReupFeedback;
      window.removeEventListener("reupai:feedback", onFeedback);
    };
  }, [beginWaiting, endWaiting, showError]);

  const value = useMemo(() => ({ showError, beginWaiting, endWaiting }), [showError, beginWaiting, endWaiting]);
  return <FeedbackContext.Provider value={value}>{children}{modal && <div className="feedback-scrim" role="presentation"><section className={`feedback-modal ${modal.type}`} role="dialog" aria-modal="true" aria-live="assertive" aria-label={modal.type === "error" ? "Đã xảy ra lỗi" : "Vui lòng chờ"}>{modal.type === "waiting" ? <span className="feedback-spinner" aria-hidden="true" /> : <span className="feedback-error-mark" aria-hidden="true">!</span>}<div><h2>{modal.type === "error" ? "Đã xảy ra lỗi" : "Vui lòng chờ"}</h2><p>{modal.message}</p></div>{modal.type === "error" && <button className="btn primary" onClick={() => setModal(null)} autoFocus>Đã hiểu</button>}</section></div>}</FeedbackContext.Provider>;
}

export function useFeedback() {
  return useContext(FeedbackContext) || { showError: () => {}, beginWaiting: () => "", endWaiting: () => {} };
}

export function sendFeedback(type, message, id) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("reupai:feedback", { detail: { type, message, id } }));
}
