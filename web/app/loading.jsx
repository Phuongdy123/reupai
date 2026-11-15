"use client";

import { useEffect, useState } from "react";

export default function RouteLoading() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDismissed(true), 10000);
    const onKeyDown = (event) => {
      if (event.key === "Escape") setDismissed(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (dismissed) return null;

  return (
    <div className="reupai-cat-loader" role="status" aria-live="polite" aria-label="Đang tải trang">
      <div className="reupai-cat-loader-card">
        <button
          type="button"
          className="reupai-cat-loader-close"
          aria-label="Đóng thông báo đang tải"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
        <div className="reupai-cat-stage" aria-hidden="true">
          <svg className="reupai-cat-track" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="46" className="reupai-cat-ring-bg" />
            <circle cx="60" cy="60" r="46" className="reupai-cat-ring-arc" />
          </svg>
          <div className="reupai-cat-orbit">
            <svg className="reupai-cat-svg" viewBox="0 0 64 64">
              <path
                d="M14 36 C6 32, 6 20, 13 18"
                fill="none"
                stroke="#fca5a5"
                strokeWidth="4"
                strokeLinecap="round"
                className="reupai-cat-tail"
              />
              <ellipse cx="30" cy="36" rx="15" ry="10" fill="#f8fafc" />
              <polygon points="36,22 40,12 45,21" fill="#f8fafc" />
              <polygon points="44,21 50,12 52,23" fill="#f8fafc" />
              <polygon points="38,20 40.5,14.5 43.5,20" fill="#ef4444" />
              <polygon points="45.5,20 49,14.5 50.5,21.5" fill="#ef4444" />
              <circle cx="44" cy="27" r="9.5" fill="#f8fafc" />
              <circle cx="42" cy="26" r="1.4" fill="#0f172a" />
              <circle cx="48" cy="26" r="1.4" fill="#0f172a" />
              <polygon points="45,28.5 43.6,30.2 46.4,30.2" fill="#ef4444" />
              <line x1="21" y1="44" x2="17" y2="52" stroke="#e2e8f0" strokeWidth="3.5" strokeLinecap="round" className="reupai-cat-leg-a" />
              <line x1="26" y1="45" x2="29" y2="53" stroke="#cbd5e1" strokeWidth="3.5" strokeLinecap="round" className="reupai-cat-leg-b" />
              <line x1="36" y1="44" x2="33" y2="52" stroke="#cbd5e1" strokeWidth="3.5" strokeLinecap="round" className="reupai-cat-leg-b" />
              <line x1="40" y1="43" x2="45" y2="51" stroke="#f8fafc" strokeWidth="3.5" strokeLinecap="round" className="reupai-cat-leg-a" />
            </svg>
          </div>
        </div>
        <span className="reupai-cat-loader-text">Đang chuẩn bị trang…</span>
      </div>
    </div>
  );
}
