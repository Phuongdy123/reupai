"use client";

import { useEffect, useState } from "react";
import { CatSpinner } from "../src/components/cat-loader";

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
        <CatSpinner size="lg" />
        <span className="reupai-cat-loader-text">Đang chuẩn bị trang…</span>
      </div>
    </div>
  );
}
