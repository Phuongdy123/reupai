"use client";

import { useEffect, useRef, useState } from "react";

const RECOVERY_KEY = "reupai:chunk-load-recovery-at";
const RECOVERY_WINDOW_MS = 60_000;

function isChunkLoadFailure(value) {
  const message = typeof value === "string" ? value : String(value?.message || value || "");
  return /chunkloaderror|loading (?:css )?chunk|failed to load chunk|css_chunk_load_failed|importing a module script failed/i.test(message);
}

export function ChunkRecovery() {
  const [showReload, setShowReload] = useState(false);
  const recovering = useRef(false);

  useEffect(() => {
    let cleanupTimer;
    const handleFailure = (error) => {
      if (!isChunkLoadFailure(error) || recovering.current) return;

      let previousAttempt = 0;
      try { previousAttempt = Number(window.sessionStorage.getItem(RECOVERY_KEY) || 0); } catch {}
      if (previousAttempt && Date.now() - previousAttempt < RECOVERY_WINDOW_MS) {
        setShowReload(true);
        return;
      }

      recovering.current = true;
      try { window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now())); } catch {}
      window.location.reload();
    };
    const handleWindowError = (event) => handleFailure(event.message || event.error);
    const handleRejection = (event) => handleFailure(event.reason);

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleRejection);
    cleanupTimer = window.setTimeout(() => {
      try { window.sessionStorage.removeItem(RECOVERY_KEY); } catch {}
    }, RECOVERY_WINDOW_MS);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleRejection);
      window.clearTimeout(cleanupTimer);
    };
  }, []);

  if (!showReload) return null;
  return (
    <div className="chunk-recovery-banner" role="alert">
      <span>Phiên bản web vừa cập nhật nhưng một phần giao diện chưa tải được.</span>
      <button type="button" onClick={() => {
        try { window.sessionStorage.removeItem(RECOVERY_KEY); } catch {}
        window.location.reload();
      }}>Tải lại trang</button>
    </div>
  );
}
